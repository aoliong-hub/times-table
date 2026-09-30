# -*- coding: utf-8 -*-
"""汉字书写打分核心：本地几何比对 → 直接换算成四维度评分。

不调 LLM、不联网：找格子、提笔迹、认字（OCR）、与标准字比对全在
core/geometry.py 里完成，本文件只负责把几何指标换算成
「占格位置/间架结构/笔画形态/笔画正确」四个维度的分数，
再套 rubric 的等级线和重写规则，产出前端要的 JSON。

换外壳（小程序后端 / CLI 批量）时直接调 score_image()。
"""

import base64
import concurrent.futures
import json
import os
import re
import sys
import time

import cv2
import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
# core/ -> hanzi-score/ -> times-table/ -> code/，几何模块的同级目录
_HANZI_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
if _HANZI_ROOT not in sys.path:
    sys.path.insert(0, _HANZI_ROOT)

try:
    from . import geometry, rubric
except ImportError:                    # 直接以脚本方式跑本文件时
    import geometry
    import rubric

_CJK_RE = re.compile("[一-鿿]")

MAX_CELLS_SCORED = 40       # 一次最多打分的格子数（控制响应体积和耗时）
MAX_CELL_WORKERS = 8        # 逐格打分的并行进程数（管线是 CPU 密集，线程会
                            # 被 GIL 串行化，必须用进程）
_CELL_POOL = None


def _row_vote_rescore(targets, all_items, cells, source_spec, target_char, pool):
    """行级多数投票：练字本每行通常是把同一个字重复写 N 遍。

    行内 ≥3 格以较高置信度认出同一个字时，该行认错/报错的格子
    （targets）大概率也是这个字——用行字作为 target_char 重打分
    （几何比对从此对着正确的标准字），并把认字结果对齐行字。
    投票看 all_items（含已流出的高置信格），重打分只动 targets。
    每行写不同字的本子（词语练习）形不成多数，自动不触发。
    """
    import collections
    if not all_items or not cells:
        return
    results = all_items
    heights = sorted(float(q[:, 1].max() - q[:, 1].min()) for q in cells)
    row_h = heights[len(heights) // 2] or 1.0
    if row_h < 1:
        return
    top = min(float(q[:, 1].min()) for q in cells)
    rows = collections.defaultdict(list)
    for it in results:
        i = it.get("cell", 0) - 1
        if not (0 <= i < len(cells)):
            continue
        yc = float(cells[i][:, 1].mean())
        rows[int((yc - top) / (0.7 * row_h))].append(it)

    redo = []                       # (item, 行字)
    for row in rows.values():
        votes = collections.Counter()
        confs = {}
        for it in row:
            ch = it.get("char")
            if not ch:
                continue
            conf = float(it.get("ocr_conf") or 0)
            if conf >= 0.35:      # 与 _OCR_ACCEPT 同档：管线已肯采用
                votes[ch] += 1
                confs[ch] = max(confs.get(ch, 0), conf)
        if not votes:
            continue
        modal, cnt = votes.most_common(1)[0]
        second = votes.most_common(2)[1][1] if len(votes) > 1 else 0
        # ≥3 票直接定；2 票且是第二名的两倍也够（其余票都各不相同）
        if cnt < 3 and not (cnt >= 2 and cnt >= 2 * second):
            continue
        for it in row:
            conf = float(it.get("ocr_conf") or 0)
            if it.get("error") or it.get("char") != modal or conf < 0.75:
                redo.append((it, modal))
    if not redo:
        return

    kind, data = source_spec
    futures = {}
    for it, modal in redo:
        i = it.get("cell", 1) - 1
        if not (0 <= i < len(cells)):
            continue
        if pool is not None:
            futures[pool.submit(_score_cell_worker, source_spec, modal,
                                i, cells[i])] = (it, modal)
        else:
            _apply_row_rescore(it, modal,
                               _score_cell_worker(source_spec, modal, i, cells[i]))
    for fut, (it, modal) in futures.items():
        _apply_row_rescore(it, modal, fut.result())


def _apply_row_rescore(item, modal, res):
    """把行投票的重打分结果写回 item：认字对齐行字，分数用新比对。"""
    item.clear()
    item.update(res)
    if "error" not in item:
        item["char"] = modal
        item["target_char"] = modal
        item["char_match"] = True
        item["row_vote"] = True


def count_cells(image_bytes):
    """轻量统计这张照片里有几个田字格（app 用于选择流式/普通响应）。"""
    return geometry.count_cells(image_bytes)


def _cell_worker_init():
    """fork 出的子进程里重置懒加载单例：onnxruntime 会话和模板缓存在
    fork 来的进程里不可靠，让每个子进程首格时自己重建（并行发生，只慢一次）。"""
    geometry._OCR = None
    geometry._template_cache = {}


def _get_cell_pool():
    global _CELL_POOL
    if _CELL_POOL is None:
        import multiprocessing as mp
        ctx = mp.get_context("fork")
        _CELL_POOL = concurrent.futures.ProcessPoolExecutor(
            max_workers=MAX_CELL_WORKERS, mp_context=ctx,
            initializer=_cell_worker_init)
    return _CELL_POOL


def _score_cell_worker(source_spec, target_char, i, quad):
    """单格打分（给进程池用）。source_spec = ("bytes"/"path", 数据)。"""
    kind, data = source_spec
    item = {"cell": i + 1}
    try:
        if kind == "bytes":
            item.update(score_image(image_bytes=data, target_char=target_char,
                                    quad=quad))
        else:
            item.update(score_image(image_path=data, target_char=target_char,
                                    quad=quad))
    except ScoreError as exc:
        item["error"] = str(exc)
    except Exception:
        item["error"] = "打分失败"
    return item

# ---- 各维度扣分力度（占格宽度的比例 / 分数），调手感只动这一段 ----
CENTER_FREE = 0.06          # 字块中心偏移格子中心 6% 以内不扣分
CENTER_MAX_DEDUCT = 10      # 占格维度里偏移最多扣几分
SIZE_SMALL_MAX = 8          # 字太小最多扣几分
SIZE_BIG_MAX = 10           # 字太大（顶格）最多扣几分
OUT_OF_BOUNDS_RATE = 40     # 出格笔画每 1% 扣 0.4 分
OUT_OF_BOUNDS_MAX = 12
MISSING_RATE = 25           # 间架：标准笔画每缺 1% 扣 0.25 分（满分 25）
SHAPE_OFF_FREE = 0.02       # 平均偏差 2% 格宽以内不扣形态分
SHAPE_OFF_FULL = 0.10       # 平均偏差到 10% 形态分扣光
TILT_FREE = 3               # 比标准字歪 3 度以内不扣
TILT_MAX_DEDUCT = 5
EXTRA_MAX_DEDUCT = 5        # 多余笔画（涂改/多写）最多扣几分
MISSING_STROKE_DEDUCT = 6   # 笔画正确：每疑似缺一笔扣几分
WRONG_CHAR_SCORE = 2        # 写错字（认出的字和目标字不一样）时的笔画正确分


class ScoreError(Exception):
    """打分失败。detail 是可以直接给用户看的中文说明。"""

    def __init__(self, detail, *, cause=None):
        super().__init__(detail)
        self.detail = detail
        self.cause = cause


def clean_target_char(text):
    """从用户输入里取第一个汉字，取不到返回 None。"""
    if not text:
        return None
    match = _CJK_RE.search(str(text))
    return match.group(0) if match else None


# ---------------------------------------------------------------- 打分换算

def _clamp(value, full):
    return int(round(max(0.0, min(float(full), value))))


def _score_grid(grid):
    """占格位置（30 分）：中心偏移、大小比例、出格。"""
    full = 30
    score = float(full)
    notes = []

    dx = abs(grid["center_offset"]["dx"])
    dy = abs(grid["center_offset"]["dy"])
    off = max(dx, dy)
    if off > CENTER_FREE:
        deduct = min(CENTER_MAX_DEDUCT, (off - CENTER_FREE) * 100)
        score -= deduct
        direction = []
        if grid["center_offset"]["dx"] > CENTER_FREE:
            direction.append("右边")
        elif grid["center_offset"]["dx"] < -CENTER_FREE:
            direction.append("左边")
        if grid["center_offset"]["dy"] > CENTER_FREE:
            direction.append("下面")
        elif grid["center_offset"]["dy"] < -CENTER_FREE:
            direction.append("上面")
        if direction:
            notes.append("字往%s挪了，写到格子正中间更好" % "、".join(direction))

    ratio = grid["size_ratio"]
    if ratio < 0.55:
        score -= min(SIZE_SMALL_MAX, (0.55 - ratio) * 40)
        notes.append("字写小了，大胆一点，占到格子的三分之二")
    elif ratio > 0.85:
        score -= min(SIZE_BIG_MAX, (ratio - 0.85) * 80)
        notes.append("字快顶出格子了，收着一点写")

    oob = grid.get("out_of_bounds_ratio") or 0
    if oob > 0.01:
        score -= min(OUT_OF_BOUNDS_MAX, oob * OUT_OF_BOUNDS_RATE)
        if not notes:
            notes.append("有笔画跑出格子了，写之前先看好格子的边")
    return _clamp(score, full), (notes[0] if notes else "位置和大小都很合适")


def _score_structure(metrics):
    """间架结构（25 分）：标准笔画被手写覆盖的程度（缺笔/整体挪位都会掉分）。"""
    full = 25
    missing = metrics.get("missing_ratio")
    if missing is None:
        return full, "没量到结构，先按满分算"
    score = full * (1.0 - missing)
    if missing > 0.2:
        comment = "有几笔和标准位置对不上，像缺了笔画或整体挪了位"
    elif missing > 0.08:
        comment = "大部分笔画都在该在的位置，个别地方再对齐一点"
    else:
        comment = "笔画排布和标准写法很接近"
    return _clamp(score, full), comment


def _score_shape(metrics):
    """笔画形态（25 分）：平均偏差、倾斜、多余笔画。"""
    full = 25
    score = float(full)
    notes = []

    mean_off = metrics.get("mean_off")
    if mean_off is not None:
        if mean_off <= SHAPE_OFF_FREE:
            score -= 0
        else:
            score -= full * min(1.0, (mean_off - SHAPE_OFF_FREE)
                                / (SHAPE_OFF_FULL - SHAPE_OFF_FREE))
        if mean_off > 0.035:
            notes.append("笔画写得有点飘，慢一点，一笔直直地写完")

    tilt = (metrics.get("tilt") or {}).get("vs_std_deg")
    if tilt is not None and abs(tilt) > TILT_FREE:
        score -= min(TILT_MAX_DEDUCT, (abs(tilt) - TILT_FREE) / 2.0)
        side = "右" if tilt > 0 else "左"
        notes.append("整个字向%s歪了，把它摆正" % side)

    extra = metrics.get("extra_ratio")
    if extra is not None and extra > 0.08:
        score -= min(EXTRA_MAX_DEDUCT, extra * 25)
        notes.append("有多余的笔画或涂改，写错了擦干净再写")
    return _clamp(score, full), (notes[0] if notes else "横平竖直，笔画很干净")


def _score_correctness(metrics, char_match, target_char, recognized):
    """笔画正确（20 分）：写错字、疑似缺笔、多余笔画。

    字写错了再漂亮也要重写，所以这里给低分会通过 rubric 的硬规则
    （correctness < 10 强制重写）传导成「需重写」。
    """
    full = 20
    notes = []

    if target_char and char_match is False:
        return WRONG_CHAR_SCORE, "写的不是「%s」，要注意看字的样子" % target_char

    score = float(full)
    missing = metrics.get("likely_missing") or []
    if missing:
        deduct = min(full - 5, MISSING_STROKE_DEDUCT * len(missing))
        score -= deduct
        notes.append("第 %s 笔没写出来或者写偏了，对照标准写法补上"
                     % "、".join(str(m + 1) for m in missing))

    clusters = metrics.get("extra_clusters") or 0
    if clusters:
        score -= min(6, 3 * clusters)
        notes.append("多出了不该有的笔画，写完检查一遍")

    if not notes:
        expected = metrics.get("expected_strokes")
        if expected:
            notes.append("笔画数对了，%d 笔都写到了" % expected)
        else:
            notes.append("没认出来是哪个字，请老师对照照片看看")
    return _clamp(score, full), notes[0]


def _best_stroke_praise(metrics):
    """挑写得最好的一笔表扬，没有就给通用鼓励。"""
    strokes = metrics.get("strokes") or []
    best = max(strokes, key=lambda s: s.get("align_ratio", 0), default=None)
    if best and best.get("align_ratio", 0) >= 0.9:
        return "第 %d 笔写得最准，就照这个感觉写其他的！" % (best["index"] + 1)
    return rubric.DEFAULT_PRAISE


def score_image_multi(*, image_bytes=None, image_path=None, target_char=None):
    """一张照片可能拍了好几个田字格：先分割格子，再逐格走单格流水线。

    找到 0 或 1 个格子时，保持 score_image 原有的单结果结构（向后兼容）；
    找到多个格子时返回 {"count": N, "results": [...]}，每个 result 带
    "cell" 序号；单个格子打分失败不拖累其它格子，以 {"error": ...} 占位。
    格子之间相互独立，用线程池并行（OCR 推理会释放 GIL，能吃满多核）。
    """
    started = time.time()
    source = image_bytes if image_bytes is not None else image_path
    if source is None:
        raise ScoreError("没有拿到图片")

    img = None
    try:
        if image_bytes is not None:
            img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8),
                               cv2.IMREAD_COLOR)
        else:
            img = cv2.imread(image_path)
    except Exception:
        img = None
    cells = geometry.find_cells(img) if img is not None else []

    if len(cells) <= 1:
        return score_image(image_bytes=image_bytes, image_path=image_path,
                           target_char=target_char)

    empty = 0
    # 格子不多时全打（打分是并行的，预筛省不了时间还可能漏检淡字）；
    # 超页的大练习纸才用预筛砍到 MAX_CELLS_SCORED 以内
    empty = 0
    if len(cells) <= MAX_CELLS_SCORED:
        queue = list(enumerate(cells))
    else:
        queue = []
        for i, quad in enumerate(cells):
            try:
                if geometry.cell_has_ink(img, quad):
                    queue.append((i, quad))
                else:
                    empty += 1
            except Exception:
                queue.append((i, quad))  # 预筛失败不放过，交给完整流程判断
        queue = queue[:MAX_CELLS_SCORED]

    kind = "bytes" if image_bytes is not None else "path"
    if len(queue) > 1:
        pool = _get_cell_pool()
        futures = [pool.submit(_score_cell_worker, (kind, source),
                               target_char, i, quad)
                   for i, quad in queue]
        results = [f.result() for f in futures]
    else:
        results = [_score_cell_worker((kind, source), target_char, i, quad)
                   for i, quad in queue]
    if len(results) > 1:
        _row_vote_rescore(results, results, cells, (kind, source), target_char,
                          _get_cell_pool() if len(results) > 1 else None)

    out = {"count": len(results), "results": results,
           "elapsed": round(time.time() - started, 3)}
    if empty:
        out["empty_cells"] = empty
        out["total_cells"] = len(cells)
    return out


def score_image_multi_stream(*, image_bytes=None, image_path=None,
                             target_char=None):
    """流式版的多格打分：逐格产出 NDJSON 行，首格可见时间 ≈ 单格耗时。

    行格式（application/x-ndjson，每行一个 JSON）：
      {"type":"meta","count":N,"empty_cells":E,"total_cells":T}
      {"type":"cell", ...单格结果...}          ← 打完一格推一格
      {"type":"done","elapsed":秒}
    单格/找不到格子时退化成一行 {"type":"single", ...完整单结果...}。
    """
    started = time.time()
    source = image_bytes if image_bytes is not None else image_path
    if source is None:
        raise ScoreError("没有拿到图片")

    img = None
    try:
        if image_bytes is not None:
            img = cv2.imdecode(np.frombuffer(image_bytes, np.uint8),
                               cv2.IMREAD_COLOR)
        else:
            img = cv2.imread(image_path)
    except Exception:
        img = None
    cells = geometry.find_cells(img) if img is not None else []

    if len(cells) <= 1:
        result = score_image(image_bytes=image_bytes, image_path=image_path,
                             target_char=target_char)
        yield json.dumps({"type": "single", **result},
                         ensure_ascii=False) + "\n"
        return

    empty = 0
    if len(cells) <= MAX_CELLS_SCORED:
        queue = list(enumerate(cells))
    else:
        queue = []
        for i, quad in enumerate(cells):
            try:
                if geometry.cell_has_ink(img, quad):
                    queue.append((i, quad))
                else:
                    empty += 1
            except Exception:
                queue.append((i, quad))
        queue = queue[:MAX_CELLS_SCORED]
    yield json.dumps({"type": "meta", "count": len(queue),
                      "empty_cells": empty, "total_cells": len(cells)},
                     ensure_ascii=False) + "\n"

    kind = "bytes" if image_bytes is not None else "path"
    done_items = []
    held = []
    if len(queue) > 1:
        pool = _get_cell_pool()
        futures = [pool.submit(_score_cell_worker, (kind, source),
                               target_char, i, quad)
                   for i, quad in queue]
        # 高置信的格子谁先完成谁先走；低置信/报错的先扣住——
        # 等行投票重打分后再流出（练字本每行同一个字）
        for fut in concurrent.futures.as_completed(futures):
            item = fut.result()
            if item.get("error") or float(item.get("ocr_conf") or 0) < 0.75:
                held.append(item)
            else:
                done_items.append(item)
    else:
        for i, quad in queue:
            done_items.append(_score_cell_worker((kind, source), target_char,
                                                 i, quad))

    if held and len(done_items) + len(held) > 1:
        for it in held:
            it["elapsed_cell"] = round(time.time() - started, 2)
        _row_vote_rescore(held, done_items + held, cells, (kind, source),
                          target_char,
                          _get_cell_pool() if len(held) > 1 else None)
    for it in sorted(held, key=lambda x: x.get("cell", 0)):
        yield json.dumps({"type": "cell", **it}, ensure_ascii=False) + "\n"

    for it in sorted(done_items, key=lambda x: x.get("cell", 0)):
        yield json.dumps({"type": "cell", **it}, ensure_ascii=False) + "\n"
    yield json.dumps({"type": "done",
                      "elapsed": round(time.time() - started, 3)},
                     ensure_ascii=False) + "\n"


def score_image(*, image_bytes=None, image_path=None, target_char=None,
                quad=None):
    """给一张田字格练字图打分（纯本地，不调任何外部服务）。

    Args:
        image_bytes: 图片字节（上传场景，不落盘）。
        image_path:  图片路径（CLI / 批量场景）。二者给一个即可。
        target_char: 这一格应该写的字，可选；不填则用 OCR 认字。
        quad: 这一格的四角点（多格分割的产物），给了就跳过单格检测。

    Returns:
        前端要的评分 dict（含 geometry / geometry_overlay / elapsed）。

    Raises:
        ScoreError: 图片不可读、找不到田字格、笔迹太淡、目标字不在字库等。
    """
    source = image_bytes if image_bytes is not None else image_path
    if source is None:
        raise ScoreError("没有拿到图片")

    target_char = clean_target_char(target_char)
    started = time.time()

    geo = geometry.extract(source, target_char, quad=quad)
    if not geo.get("ok"):
        reason = geo.get("reason")
        detail = geo.get("detail") or "图片没量出有效内容"
        if reason == "no_cell":
            raise ScoreError("没找到田字格，把格子拍正、拍满整张图再试一次")
        if reason == "too_faint":
            raise ScoreError("笔迹太淡了，写重一点、光线亮一点再拍")
        raise ScoreError("图片没法打分：%s" % detail)

    metrics = geo["metrics"]
    recognized = geo.get("recognized") or []
    ocr_char = geo.get("char")
    ref_char = geo.get("ref_char")
    char_match = None
    if target_char:
        char_match = (ocr_char == target_char) if ocr_char else None

    # 四个维度
    grid_score, grid_comment = _score_grid(metrics["grid"])
    struct_score, struct_comment = _score_structure(metrics)
    shape_score, shape_comment = _score_shape(metrics)
    correct_score, correct_comment = _score_correctness(
        metrics, char_match, target_char, recognized)

    scores = {"grid": grid_score, "structure": struct_score,
              "stroke_shape": shape_score, "correctness": correct_score}
    total = sum(scores.values())
    verdict = rubric.grade(total, scores)

    # 写错字：无论总分多少都重写（本地版的硬规则，等价于原来的 correctness<10）
    if target_char and char_match is False:
        verdict["need_rewrite"] = True
        verdict["rewrite_reason"] = "写的不是「%s」" % target_char

    dimensions = []
    for dim in rubric.DIMENSIONS:
        dimensions.append({
            "key": dim["key"],
            "name": dim["name"],
            "score": scores[dim["key"]],
            "full": dim["full"],
            "comment": {
                "grid": grid_comment,
                "structure": struct_comment,
                "stroke_shape": shape_comment,
                "correctness": correct_comment,
            }[dim["key"]],
        })

    # 改进点：直接从几何摘要里挑最要紧的几条
    improvements = (geo.get("lines") or [])[:rubric.MAX_IMPROVEMENTS]
    advice = None
    if verdict["need_rewrite"]:
        advice = "别灰心，擦掉再写一遍。" + (improvements[0] if improvements
                                             else "这次写在格子正中间，慢一点。")

    # 叠加图（对比给家长孩子看）：画的是「应该照着写」的标准字，按层拆分供前端筛选
    overlay_uri = None
    std = geometry.load_standard(ref_char) if ref_char else None
    if std:
        stroke_scores = [s.get("align_ratio") for s in (metrics.get("strokes") or [])]
        pngs = geometry.build_overlay_pngs(
            geo.get("warped"), std, geo.get("ink"), stroke_scores=stroke_scores)
        if pngs:
            overlay_uri = {name: ("data:image/png;base64,"
                                  + base64.b64encode(png).decode("ascii"))
                           for name, png in pngs.items() if png}

    geometry_out = {
        "ok": True,
        "char": ocr_char,
        "ref_char": ref_char,
        "metrics": metrics,
        "lines": geo.get("lines") or [],
        "recognized": recognized,
    }

    ocr_conf = 0.0
    if recognized:
        ocr_conf = float(recognized[0].get("score") or 0)
    return {
        "char": ocr_char or "?",
        "target_char": target_char,
        "char_match": char_match,
        "ocr_conf": round(ocr_conf, 4),
        "total": total,
        "full_marks": rubric.FULL_MARKS,
        "level": verdict["level"],
        "badge": verdict["badge"],
        "emoji": verdict["emoji"],
        "need_rewrite": verdict["need_rewrite"],
        "rewrite_reason": verdict["rewrite_reason"],
        "rewrite_advice": advice,
        "praise": _best_stroke_praise(metrics),
        "improvements": improvements,
        "dimensions": dimensions,
        "geometry": geometry_out,
        "geometry_overlay": overlay_uri,
        "elapsed": round(time.time() - started, 3),
    }
