# -*- coding: utf-8 -*-
"""本地几何比对：田字格照片 → 归一化 → 笔迹提取 → 与标准字比对 → 认字。

在调 LLM 之前先用图像处理量出可解释的差异：字在格子里的位置、大小，
笔迹和标准笔画的偏差，整体倾斜；目标字没填时用模板匹配从标准字库认字。
标准字数据来自 hanzi-writer-data（medians 是每笔的中线点，1024×1024，y 向下）。

只用 cv2 / numpy / skimage / PIL，不联网、不 import fastapi。
所有对外函数都不抛异常：任何一步失败都返回 ok=False 的 dict，
打分链路照常走，几何只是「量不出来」而不是「打不了分」。
"""

import json
import math
import os
import re

import cv2
import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
# core/ -> hanzi-score/ -> times-table/ -> code/ -> dataset_gy_liaoyongxin/
_DEFAULT_DATA_DIR = os.path.abspath(
    os.path.join(_HERE, "..", "..", "..", "..", "dataset", "hanzi-writer-data"))

GRID_SIZE = 1024          # 归一化后的边长，与 hanzi-writer-data 坐标系一致
HANZI_DATA_DIR = os.environ.get("HANZI_DATA_DIR", _DEFAULT_DATA_DIR)

# 本地认字的候选池：一级常用字 3500 个，一年级学的字都在里面
RECOGNIZE_CHARSET = "chars_3500.txt"
_RECOGNIZE_RENDER = 256   # 认字模板的渲染边长（比对前再缩到 64）
_RECOGNIZE_SIZE = 64      # 比对用的统一边长

# —— 比对阈值（比例均相对 GRID_SIZE，即「占格宽度的百分比」）——
COVER_DIST = 0.05         # 标准笔画中线点离手写墨迹 < 5% 格宽算「写到了」
MISSING_DIST = 0.08       # 一笔的中线平均距离超过 8% → 疑似缺笔/严重偏移
EXTRA_DIST = 0.08         # 手写骨架点离所有标准笔画 > 8% → 算「多出来的」
SIZE_RATIO_MIN = 0.55     # 字块高(宽)占格比例的合理区间
SIZE_RATIO_MAX = 0.85
CENTER_TOL = 0.06         # 字块中心偏移格子中心超过 6% → 明显偏
STROKE_W_MIN = 24         # 标准字渲染线宽的夹取范围（px @1024）
STROKE_W_MAX = 56
DEFAULT_STROKE_W = 36     # 拿不到实测笔画宽时的默认线宽
INK_MIN_RATIO = 0.008     # 墨迹像素占比低于 0.8% → too_faint
NOISE_AREA = 0.00005 * GRID_SIZE * GRID_SIZE   # 小于它的连通域当噪点
LINE_THIN = 12            # 归一化后细于它的长直线当格线（笔画一般 15px 以上）
LINE_LONG = 0.85 * GRID_SIZE   # 长过它的细直线当格线
RED_KILL_FALLBACK = 0.2   # 剔红线后墨迹不足纯二值化的 20% → 认为误杀，回退

_CJK_RE = re.compile("[一-鿿]")

# hanzi-writer-data 的 medians 实测是 **y 轴向上**（README 写的「y 向下」与数据不符，
# 直接渲染是倒字）。加载时统一翻成 y 向下，跟照片归一化后的坐标系一致。
DATA_Y_UP = True

# 懒加载缓存
_index_cache = None       # {char: 笔画数}
_standard_cache = {}      # {char: {"medians":…, "stroke_count":…}}
_template_cache = {}      # 认字模板 {char: (points64, aspect)}
_charset_cache = None     # 认字候选字列表


# ---------------------------------------------------------------- 标准字

def _load_index():
    """index.json 懒加载成 {char: 笔画数}，读不到就当空表。"""
    global _index_cache
    if _index_cache is None:
        path = os.path.join(HANZI_DATA_DIR, "index.json")
        try:
            with open(path, encoding="utf-8") as fh:
                _index_cache = {item["char"]: item["strokes"] for item in json.load(fh)}
        except Exception:
            _index_cache = {}
    return _index_cache


def load_standard(char):
    """读 data/<char>.json。返回 {"strokes","medians","stroke_count"}，拿不到返回 None。"""
    if not char or not _CJK_RE.fullmatch(char):
        return None
    if char in _standard_cache:
        return _standard_cache[char]
    path = os.path.join(HANZI_DATA_DIR, "data", char + ".json")
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        medians = data.get("medians")
        if not medians:
            result = None
        else:
            if DATA_Y_UP:
                medians = [[[x, GRID_SIZE - y] for x, y in stroke] for stroke in medians]
            result = {
                "strokes": data.get("strokes") or [],
                "medians": medians,
                "stroke_count": _load_index().get(char, len(medians)),
            }
    except Exception:
        result = None
    _standard_cache[char] = result
    return result


def render_standard_mask(medians, size=GRID_SIZE, width=None):
    """把逐笔中线点画成 uint8 mask（0/255）。

    medians 坐标是 1024 空间的，按 size 等比缩放后再画（size<1024 时坐标
    不缩放会被 polylines 整段裁掉，只剩碎片）。
    width=None 用默认线宽（随 size 缩放）；传手写实测笔画宽可让两边
    粗细对齐，把「笔画写得粗/细」从形状偏差里消掉。
    """
    scale = size / float(GRID_SIZE)
    if width is None:
        width = DEFAULT_STROKE_W
    width = int(max(1, min(round(width * scale) if size != GRID_SIZE else width,
                           size // 4)))
    canvas = np.zeros((size, size), np.uint8)
    for stroke in medians:
        pts = (np.array(stroke, np.float64) * scale).astype(np.int32).reshape(-1, 1, 2)
        if len(pts) == 1:                       # 点：画个小圆
            (x, y) = pts[0, 0]
            cv2.circle(canvas, (int(x), int(y)), width // 2, 255, -1)
        else:
            cv2.polylines(canvas, [pts], False, 255, width)
    return canvas


# ---------------------------------------------------------------- 照片管线

def _red_mask(bgr):
    """淡红格线的 HSV mask（H 两端都取，S/V 卡掉灰底和阴影）。"""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    return (((h <= 10) | (h >= 170)) & (s > 90) & (v > 60)).astype(np.uint8) * 255


def _order_quad(pts):
    """四个角点排成 左上/右上/右下/左下，供透视变换用。

    左上 x+y 最小、右下 x+y 最大；右上 x−y 最大、左下 x−y 最小。
    """
    pts = np.array(pts, np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    d = pts[:, 0] - pts[:, 1]
    return np.array([pts[np.argmin(s)], pts[np.argmax(d)],
                     pts[np.argmax(s)], pts[np.argmin(d)]], np.float32)


def find_cell(bgr):
    """检测田字格外框。返回 {"quad","method"}，不是田字格照片返回 None。

    红线 mask 里虚线中线会和外框连成一个连通域，没关系——
    取最大连通域的外轮廓，包住它的仍然是外框四边形。
    """
    red = _red_mask(bgr)
    if cv2.countNonZero(red) < 0.005 * red.size:
        return None
    closed = cv2.morphologyEx(red, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, labels = cv2.connectedComponents(closed, 8)
    if n < 2:
        return None
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    idx = int(np.argmax(counts))
    red_total = cv2.countNonZero(red)
    if counts[idx] < 0.5 * red_total:     # 最大的那个连通域得吃掉大部分红线
        return None
    keep = np.zeros_like(closed)
    keep[labels == idx] = 255
    contours, _ = cv2.findContours(keep, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(contour, True)
    approx = cv2.approxPolyDP(contour, 0.02 * peri, True)
    if len(approx) == 4 and cv2.isContourConvex(approx) and \
            cv2.contourArea(approx) > 0.3 * red.size:
        return {"quad": _order_quad(approx.reshape(4, 2)), "method": "poly"}
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    if cv2.contourArea(box) > 0.3 * red.size:
        return {"quad": _order_quad(box), "method": "rect"}
    return None


def warp_to_cell(bgr, quad, size=GRID_SIZE):
    """把四角围出的格子透视归一到 size×size（y 向下，与标准字坐标系一致）。"""
    dst = np.array([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]],
                   np.float32)
    mat = cv2.getPerspectiveTransform(np.asarray(quad, np.float32), dst)
    return cv2.warpPerspective(bgr, mat, (size, size))


def extract_ink(warped):
    """从归一化图提取墨迹 mask（0/255）。抗阴影用局部阈值，红线连抗锯齿边一起剔。"""
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    try:
        from skimage.filters import threshold_sauvola
        thresh = threshold_sauvola(gray, window_size=61, k=0.2)
        binary = ((gray < thresh) * 255).astype(np.uint8)
    except Exception:
        # skimage 不可用时退 Otsu（阴影稳健性差些，合成图够用）
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    base_ratio = cv2.countNonZero(binary) / binary.size
    if base_ratio <= 0:
        return binary

    red = _red_mask(warped)
    if cv2.countNonZero(red):
        red_big = cv2.dilate(red, np.ones((7, 7), np.uint8))
        cleaned = cv2.bitwise_and(binary, cv2.bitwise_not(red_big))
        if cv2.countNonZero(cleaned) >= RED_KILL_FALLBACK * cv2.countNonZero(binary):
            binary = cleaned

    # 去噪点、剔幸存的细长格线（一字的横约 20px 粗，不会被误删）
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    keep = np.zeros_like(binary)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < NOISE_AREA:
            continue
        thin = min(w, h) < LINE_THIN
        long_line = max(w, h) > LINE_LONG
        if thin and long_line:
            continue
        keep[labels == i] = 255
    return keep


# ---------------------------------------------------------------- 本地认字

def _charset():
    """认字候选列表（chars_3500.txt），读不到就退 index.json 全部字。"""
    global _charset_cache
    if _charset_cache is None:
        chars = []
        path = os.path.join(HANZI_DATA_DIR, RECOGNIZE_CHARSET)
        try:
            with open(path, encoding="utf-8") as fh:
                chars = [ch for line in fh for ch in line if _CJK_RE.fullmatch(ch)]
        except Exception:
            pass
        if not chars:
            chars = list(_load_index().keys())
        _charset_cache = chars
    return _charset_cache


def _norm_blob(mask, size=_RECOGNIZE_SIZE):
    """bbox 裁剪 → 等比缩放居中到 size×size（不拉伸，保住形状差异）。

    返回 uint8 mask；空图返回 None。
    """
    ys, xs = np.nonzero(mask > 0)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    crop = mask[y0:y1 + 1, x0:x1 + 1]
    side = max(crop.shape)
    pad = np.zeros((side, side), np.uint8)
    oy = (side - crop.shape[0]) // 2
    ox = (side - crop.shape[1]) // 2
    pad[oy:oy + crop.shape[0], ox:ox + crop.shape[1]] = crop
    scaled = cv2.resize(pad, (size, size), interpolation=cv2.INTER_AREA)
    return (scaled > 0).astype(np.uint8) * 255


def _dt_of(mask):
    """mask 的距离变换：非墨迹处离最近墨迹的距离。"""
    return cv2.distanceTransform(cv2.bitwise_not(mask), cv2.DIST_L2, 3)


def _points_mask(points, size=_RECOGNIZE_SIZE):
    """点集画回 size×size 小 mask（略膨胀），供算距离变换。"""
    canvas = np.zeros((size, size), np.uint8)
    pts = np.round(points).astype(np.int32)
    keep = (pts[:, 0] >= 0) & (pts[:, 0] < size) & (pts[:, 1] >= 0) & (pts[:, 1] < size)
    if keep.any():
        canvas[pts[keep, 1], pts[keep, 0]] = 255
        canvas = cv2.dilate(canvas, np.ones((3, 3), np.uint8))
    return canvas


_OCR_MIN_CONF = 0.5      # OCR 置信度低于它时，用模板匹配补几个形近候选
_ocr_engine = None       # RapidOCR 懒加载单例


def _get_ocr():
    """RapidOCR 单例（轻量 PP-OCRv4 ONNX 模型，CPU 推理）。没装返回 None。"""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _ocr_engine = RapidOCR()
        except Exception:
            _ocr_engine = False        # False = 试过了，没有
    return _ocr_engine or None


def _char_crop_clean(warped, ink, size=64, margin=0.2):
    """从归一化图里裁出字块：白底黑字（格线已剔），等比留边，方pad 后缩放。

    这是喂给 OCR 识别模型的图：去格线干扰、居中、大小统一。
    """
    ys, xs = np.nonzero(ink > 0)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    m = int(margin * max(x1 - x0, y1 - y0))
    h, w = warped.shape[:2]
    x0, y0 = max(0, x0 - m), max(0, y0 - m)
    x1, y1 = min(w, x1 + m), min(h, y1 + m)
    crop = warped[y0:y1 + 1, x0:x1 + 1]
    clean = np.full_like(crop, 255)
    clean[ink[y0:y1 + 1, x0:x1 + 1] > 0] = (40, 40, 40)
    side = max(clean.shape[:2])
    pad = np.full((side, side, 3), 255, np.uint8)
    oy, ox = (side - clean.shape[0]) // 2, (side - clean.shape[1]) // 2
    pad[oy:oy + clean.shape[0], ox:ox + clean.shape[1]] = clean
    return cv2.resize(pad, (size, size))


def recognize_char(ink_mask, warped=None, top_n=5):
    """认出照片里写的字，返回 Top-N [{"char","score","source"}] 或 None。

    主路：轻量 OCR（RapidOCR，CPU ~0.1s）。OCR 没装 / 没认出 / 置信度低时，
    用模板匹配（对标准字库算对称 chamfer + IoU）补形近候选。
    score 是置信度（0~1，越大越像）。
    """
    try:
        results = []
        seen = set()

        ocr = _get_ocr() if warped is not None else None
        if ocr is not None:
            crop = _char_crop_clean(warped, ink_mask)
            if crop is not None:
                res, _ = ocr(crop, use_det=False, use_cls=False, use_rec=True)
                if res:
                    text, conf = res[0][0], float(res[0][1])
                    # 破折号/片假名这类 OCR 常见误认，换回汉字「一」
                    if text in ("—", "—", "ー", "－"):
                        text = "一"
                    if _CJK_RE.search(text or ""):
                        ch = _CJK_RE.search(text).group(0)
                        results.append({"char": ch, "score": round(conf, 4),
                                        "source": "ocr"})
                        seen.add(ch)

        if not results or results[0]["score"] < _OCR_MIN_CONF:
            for cand in recognize_char_by_template(ink_mask, top_n=top_n):
                if cand["char"] not in seen:
                    results.append(cand)
                    seen.add(cand["char"])

        return results[:top_n] or None
    except Exception:
        return None


def recognize_char_by_template(ink_mask, top_n=5):
    """模板匹配认字（OCR 的兜底）：手写墨迹 vs 标准字库。

    score 是相似度（0~1，越大越像）。首次调用要渲染整个候选池（几秒），之后走缓存。
    """
    global _template_cache
    try:
        ink64 = _norm_blob(ink_mask)
        if ink64 is None or cv2.countNonZero(ink64) < 16:
            return []
        ink_pts = np.column_stack(np.nonzero(ink64 > 0))[:, ::-1].astype(np.float32)
        dt_ink = _dt_of(ink64)
        ink_d = cv2.dilate(ink64, np.ones((3, 3), np.uint8))

        scored = []
        for char in _charset():
            if char not in _template_cache:
                std = load_standard(char)
                if not std:
                    _template_cache[char] = None
                else:
                    m = render_standard_mask(std["medians"], size=_RECOGNIZE_RENDER,
                                             width=max(2, _RECOGNIZE_RENDER // 24))
                    _template_cache[char] = _norm_blob(m)
            tpl = _template_cache[char]
            if tpl is None or cv2.countNonZero(tpl) < 8:
                continue
            dt_std = _dt_of(tpl)
            std_pts = np.column_stack(np.nonzero(tpl > 0))[:, ::-1].astype(np.float32)
            # 对称 chamfer（平均每点离对方笔画的距离 / 64）
            d1 = float(dt_ink[std_pts[:, 1].astype(int), std_pts[:, 0].astype(int)].mean())
            d2 = float(dt_std[ink_pts[:, 1].astype(int), ink_pts[:, 0].astype(int)].mean())
            chamfer = 0.5 * (d1 + d2) / _RECOGNIZE_SIZE
            # 形状重合率：互相膨胀后算 IoU，字库里形状相近的字靠它分开
            inter = cv2.countNonZero(cv2.bitwise_and(
                ink_d, cv2.dilate(tpl, np.ones((3, 3), np.uint8))))
            union = cv2.countNonZero(cv2.bitwise_or(ink_d, tpl))
            iou = inter / union if union else 0.0
            sim = 1.0 - (0.5 * chamfer + 0.5 * (1 - iou))
            scored.append({"char": char, "score": round(sim, 4), "source": "template"})
        scored.sort(key=lambda item: -item["score"])
        return scored[:top_n]
    except Exception:
        return []


# ---------------------------------------------------------------- 比对

def _skeleton_points(ink_mask, max_points=6000):
    """墨迹骨架的采样点（x, y）。骨架化在笔画交叉处会粘连，只用来算「多了」。"""
    try:
        from skimage.morphology import skeletonize
        sk = skeletonize(ink_mask > 0)
        ys, xs = np.nonzero(sk)
        pts = np.column_stack([xs, ys]).astype(np.float32)
        if len(pts) > max_points:
            pts = pts[:: len(pts) // max_points + 1]
        return pts
    except Exception:
        return np.zeros((0, 2), np.float32)


def _principal_angle(mask):
    """墨迹主轴相对水平的倾角（度，[-45,45]）。空图返回 None。"""
    ys, xs = np.nonzero(mask > 0)
    if len(xs) < 20:
        return None
    pts = np.column_stack([xs, ys]).astype(np.float64)
    if len(pts) > 20000:
        pts = pts[:: len(pts) // 20000 + 1]
    pts = pts - pts.mean(axis=0)
    cov = pts.T @ pts / len(pts)
    eigvals, eigvecs = np.linalg.eigh(cov)
    v = eigvecs[:, np.argmax(eigvals)]
    deg = math.degrees(math.atan2(v[1], v[0]))
    while deg > 45:
        deg -= 90
    while deg < -45:
        deg += 90
    return round(deg, 1)


def _align_standard(std_mask, std_medians, ix0, iy0, ix1, iy1, stroke_w):
    """把标准字平移缩放到手写字块上（bbox 对 bbox），返回 (mask, medians)。

    比形状前必须做这一步：标准字铺满 1024 画布而手写只占格子的七成，
    不对齐的话偏差全是「大小不一样」的假象。位置/大小本身由占格指标单独评价。
    """
    ys, xs = np.nonzero(std_mask > 0)
    if len(xs) == 0:
        return std_mask, std_medians
    bx0, bx1 = float(xs.min()), float(xs.max())
    by0, by1 = float(ys.min()), float(ys.max())
    sx = (ix1 - ix0) / max(1.0, bx1 - bx0)
    sy = (iy1 - iy0) / max(1.0, by1 - by0)

    aligned = []
    for stroke in std_medians:
        pts = np.array(stroke, np.float64).reshape(-1, 2)
        pts[:, 0] = (pts[:, 0] - bx0) * sx + ix0
        pts[:, 1] = (pts[:, 1] - by0) * sy + iy0
        aligned.append(pts.tolist())
    mask = render_standard_mask(aligned, width=stroke_w or DEFAULT_STROKE_W)
    return mask, aligned


def compare(ink_mask, std_mask, std_medians, stroke_count):
    """手写墨迹 vs 标准字，返回计划里的指标结构（全部相对格宽的比例）。"""
    size = ink_mask.shape[0]
    result = {"mean_off": None, "p90_off": None, "extra_ratio": None,
              "missing_ratio": None, "strokes": None,
              "likely_missing": [], "extra_clusters": None}

    # —— 占格 ——
    ys, xs = np.nonzero(ink_mask > 0)
    if len(xs) == 0:
        return result
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    cx, cy = xs.mean(), ys.mean()
    grid = {
        "center_offset": {"dx": round((cx - size / 2) / size, 4),
                          "dy": round((cy - size / 2) / size, 4)},
        "bbox": {"left": round(x0 / size, 4), "top": round(y0 / size, 4),
                 "right": round(1 - x1 / size, 4), "bottom": round(1 - y1 / size, 4)},
        "size_ratio": round(max(x1 - x0, y1 - y0) / size, 4),
    }
    margin = 0.05 * size
    out = int(np.count_nonzero((xs < margin) | (xs > size - margin)
                               | (ys < margin) | (ys > size - margin)))
    grid["out_of_bounds_ratio"] = round(out / max(1, len(xs)), 4)

    # —— 墨迹质量 ——
    dt_ink = cv2.distanceTransform(cv2.bitwise_not(ink_mask), cv2.DIST_L2, 3)
    dt_in_ink = cv2.distanceTransform(ink_mask, cv2.DIST_L2, 3)   # 墨迹内半宽
    # 逐连通域实测笔画宽（距离变换最大值×2 的中位数）
    _, labels, stats, _ = cv2.connectedComponentsWithStats(ink_mask, 8)
    widths = []
    for i in range(1, len(stats)):
        w_px = float(dt_in_ink[labels == i].max()) * 2
        if w_px > 0:
            widths.append(w_px)
    stroke_w = int(round(float(np.median(widths)))) if widths else None
    ink = {
        "pixel_ratio": round(cv2.countNonZero(ink_mask) / ink_mask.size, 4),
        "stroke_width_px": stroke_w,
        "components": int(len(stats) - 1),
    }

    # —— 形状（需要标准字；先把标准字仿射到手写 bbox 上，位置/大小差异已由占格指标管）——
    skeleton = _skeleton_points(ink_mask)
    std_mask_a = None
    if std_mask is not None and cv2.countNonZero(std_mask) and std_medians:
        std_mask_a, std_medians_a = _align_standard(
            std_mask, std_medians, x0, y0, x1, y1, stroke_w)
        dt_std = cv2.distanceTransform(cv2.bitwise_not(std_mask_a), cv2.DIST_L2, 3)
        if len(skeleton):
            d = dt_std[skeleton[:, 1].astype(int), skeleton[:, 0].astype(int)]
            d = d / size
            result["mean_off"] = round(float(d.mean()), 4)
            result["p90_off"] = round(float(np.percentile(d, 90)), 4)
            result["extra_ratio"] = round(float((d > EXTRA_DIST).mean()), 4)
            far = d > EXTRA_DIST
            if far.any():
                far_mask = np.zeros_like(ink_mask)
                fp = skeleton[far].astype(np.int32)
                far_mask[fp[:, 1], fp[:, 0]] = 255
                n_far, lab_far, stat_far, _ = cv2.connectedComponentsWithStats(far_mask, 8)
                result["extra_clusters"] = int(
                    sum(1 for i in range(1, n_far)
                        if stat_far[i, cv2.CC_STAT_AREA] > 0.002 * size * size))

        # 逐笔覆盖：对齐后的中线点直接采手写墨迹的距离变换
        strokes = []
        covered_pts = 0
        total_pts = 0
        for idx, stroke in enumerate(std_medians_a):
            pts = np.clip(np.array(stroke, np.float32), 0, size - 1)
            d = dt_ink[pts[:, 1].astype(int), pts[:, 0].astype(int)] / size
            mean_d = float(d.mean()) if len(d) else 1.0
            total_pts += len(d)
            covered_pts += int((d < COVER_DIST).sum())
            strokes.append({
                "index": idx,
                "mean_off": round(mean_d, 4),
                "covered": bool(mean_d < COVER_DIST),
                "missing": bool(mean_d > MISSING_DIST),
            })
        result["strokes"] = strokes
        result["missing_ratio"] = round(1 - covered_pts / max(1, total_pts), 4)
        result["likely_missing"] = [s["index"] for s in strokes if s["missing"]]

    # —— 倾斜 ——
    tilt = {"principal_deg": _principal_angle(ink_mask)}
    if std_mask_a is not None:
        tilt["vs_std_deg"] = None
        ang_std = _principal_angle(std_mask_a)
        if tilt["principal_deg"] is not None and ang_std is not None:
            tilt["vs_std_deg"] = round(tilt["principal_deg"] - ang_std, 1)

    result["grid"] = grid
    result["ink"] = ink
    result["tilt"] = tilt
    result["expected_strokes"] = stroke_count
    return result


# ---------------------------------------------------------------- 入口/输出

def _load_source(source):
    """bytes 或路径 → BGR 图。失败返回 None。"""
    try:
        if isinstance(source, bytes):
            arr = np.frombuffer(source, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        else:
            img = cv2.imread(str(source), cv2.IMREAD_COLOR)
        return img
    except Exception:
        return None


def extract(source, char=None):
    """总入口：照片（bytes/路径）→ 几何指标。永不抛异常。

    char 给了就用它当标准字；没给就先本地认字，取最像的当参考。
    返回：
      成功 {"ok":True, "char":参考字|None, "metrics":…, "lines":[…],
            "recognized":[…]|None, "warped":ndarray, "ink":ndarray}
      失败 {"ok":False, "reason":"no_cell|too_faint|error", "detail":…}
    """
    try:
        img = _load_source(source)
        if img is None:
            return {"ok": False, "reason": "error", "detail": "图片读不开"}
        cell = find_cell(img)
        if cell is None:
            return {"ok": False, "reason": "no_cell", "detail": "没找到田字格外框"}
        warped = warp_to_cell(img, cell["quad"])
        ink = extract_ink(warped)
        if cv2.countNonZero(ink) < INK_MIN_RATIO * ink.size:
            return {"ok": False, "reason": "too_faint", "detail": "笔迹太淡或没写到"}

        recognized = None
        ref_char = char
        std = load_standard(char) if char else None
        if char and std is None:
            ref_char = None
        if not char:
            recognized = recognize_char(ink, warped=warped)
            if recognized:
                ref_char = recognized[0]["char"]
                std = load_standard(ref_char)

        metrics = compare(ink, render_standard_mask(std["medians"]) if std else None,
                          std["medians"] if std else None,
                          std["stroke_count"] if std else None)
        metrics["quality"] = _quality(metrics)
        lines = summarize_text(metrics, ref_char, recognized)

        return {
            "ok": True,
            "char": ref_char,
            "metrics": metrics,
            "lines": lines or [],
            "recognized": recognized,
            "warped": warped,
            "ink": ink,
        }
    except Exception as exc:
        return {"ok": False, "reason": "error", "detail": str(exc)[:120]}


def _quality(metrics):
    """给整次测量一个粗略质量标签。"""
    ink = metrics.get("ink") or {}
    if (ink.get("pixel_ratio") or 0) < INK_MIN_RATIO:
        return "too_faint"
    if ink.get("components", 0) > 30:
        return "blurry"
    return "good"


def _dashed_line(img, p1, p2, color, thickness, dash=28, gap=18):
    """画虚线段（米字格的中线和斜线用）。"""
    p1 = np.array(p1, np.float64)
    p2 = np.array(p2, np.float64)
    length = float(np.linalg.norm(p2 - p1))
    if length < 1:
        return
    direction = (p2 - p1) / length
    pos = 0.0
    while pos < length:
        end = min(pos + dash, length)
        a = (p1 + direction * pos).astype(int)
        b = (p1 + direction * end).astype(int)
        cv2.line(img, tuple(a), tuple(b), color, thickness, cv2.LINE_AA)
        pos = end + gap


def draw_rice_grid(size=GRID_SIZE, color=(205, 205, 235), thickness=4):
    """画一张米字格底板（BGR）：实线外框 + 虚线的横中/竖中/两条对角线。

    手写照片已经透视归一到 0~size 坐标系，标准字 medians 也是同一坐标系，
    所以格子画在整张画布上，两边自然对齐。
    """
    grid = np.full((size, size, 3), 250, np.uint8)      # 纸色
    cv2.rectangle(grid, (2, 2), (size - 3, size - 3), color, thickness)
    mid = size // 2
    _dashed_line(grid, (2, mid), (size - 3, mid), color, max(2, thickness - 2))
    _dashed_line(grid, (mid, 2), (mid, size - 3), color, max(2, thickness - 2))
    _dashed_line(grid, (2, 2), (size - 3, size - 3), color, max(2, thickness - 2))
    _dashed_line(grid, (size - 3, 2), (2, size - 3), color, max(2, thickness - 2))
    return grid


def build_overlay_png(warped, medians, ink=None):
    """对比图：米字格底板 + 手写笔迹（黑）+ 标准笔画（红色中线，起点画圆点）。

    手写和标准都在同一个透视归一后的米字格里，差距直接可见；
    ink 给了就把偏离标准较远的墨迹叠淡黄。返回 PNG bytes，失败返回 None。
    """
    try:
        overlay = draw_rice_grid()

        if ink is None or not cv2.countNonZero(ink):
            # 拿不到笔迹 mask 就用提亮后的照片做底（至少能看）
            photo = cv2.convertScaleAbs(warped, alpha=1.25, beta=30)
            overlay = cv2.addWeighted(overlay, 0.35, photo, 0.65, 0)
        else:
            overlay[ink > 0] = (34, 34, 34)                 # 手写墨迹

        if ink is not None and medians and cv2.countNonZero(ink):
            std_mask = render_standard_mask(medians)
            dt_std = cv2.distanceTransform(cv2.bitwise_not(std_mask), cv2.DIST_L2, 3)
            ys, xs = np.nonzero(ink > 0)
            if len(xs):
                d = dt_std[ys, xs] / GRID_SIZE
                far = d > EXTRA_DIST
                if far.any():
                    overlay[ys[far], xs[far]] = (120, 200, 255)   # 淡黄 (BGR)

        if medians:
            for stroke in medians:
                pts = np.array(stroke, np.int32).reshape(-1, 1, 2)
                cv2.polylines(overlay, [pts], False, (0, 0, 255), 6, cv2.LINE_AA)
                cv2.circle(overlay, tuple(pts[0, 0]), 10, (0, 0, 255), -1, cv2.LINE_AA)

        ok, buf = cv2.imencode(".png", overlay)
        return buf.tobytes() if ok else None
    except Exception:
        return None


def summarize_text(metrics, char=None, recognized=None):
    """指标 → 中文行（提示词和前端共用，格式化只写这一份）。全空返回 None。"""
    lines = []
    grid = metrics.get("grid") or {}
    tilt = metrics.get("tilt") or {}
    ink = metrics.get("ink") or {}

    if grid.get("center_offset") is not None:
        dx, dy = grid["center_offset"]["dx"], grid["center_offset"]["dy"]
        parts = []
        if abs(dx) >= 0.005:
            parts.append("偏%s %d%%" % ("右" if dx > 0 else "左", round(abs(dx) * 100)))
        if abs(dy) >= 0.005:
            parts.append("偏%s %d%%" % ("下" if dy > 0 else "上", round(abs(dy) * 100)))
        pos = "、" .join(parts) if parts else "基本居中"
        ratio = grid.get("size_ratio")
        size_txt = ""
        if ratio:
            if ratio < SIZE_RATIO_MIN:
                size_txt = "；字偏小"
            elif ratio > SIZE_RATIO_MAX:
                size_txt = "；字偏大，快顶出格子"
        lines.append("占格：字的中心%s，大小约占格子的 %d%%%s"
                     % (pos, round((ratio or 0) * 100) or 72, size_txt))
    if grid.get("out_of_bounds_ratio") and grid["out_of_bounds_ratio"] > 0.01:
        lines.append("出格：约有 %d%% 的笔画顶出了格子"
                     % round(grid["out_of_bounds_ratio"] * 100))

    shape_ok = metrics.get("mean_off") is not None
    if shape_ok:
        lines.append("贴合：平均每笔偏离标准位置约 %d%% 格宽"
                     % round(metrics["mean_off"] * 100))

    strokes = metrics.get("strokes")
    if strokes:
        missing = [s["index"] + 1 for s in strokes if s["missing"]]
        if missing:
            lines.append("覆盖：第 %s 笔离标准位置比较远，可能写偏了或缺了笔画"
                         % "、".join(str(m) for m in missing))
        elif metrics.get("missing_ratio") is not None and metrics["missing_ratio"] > 0.15:
            lines.append("覆盖：有几笔和标准位置对不太上，整体往一边挪了")

    if tilt.get("vs_std_deg") is not None and abs(tilt["vs_std_deg"]) >= 3:
        lines.append("倾斜：整体比标准字向%s歪约 %d 度"
                     % ("右" if tilt["vs_std_deg"] > 0 else "左", round(abs(tilt["vs_std_deg"]))))
    elif tilt.get("principal_deg") is not None and abs(tilt["principal_deg"]) >= 5:
        lines.append("倾斜：整体向%s歪约 %d 度"
                     % ("右" if tilt["principal_deg"] > 0 else "左", round(abs(tilt["principal_deg"]))))

    if recognized:
        best = recognized[0]
        others = "、".join(r["char"] for r in recognized[1:3])
        lines.append("认字：程序猜这个字最像「%s」%s"
                     % (best["char"], ("，其次像 " + others) if others else ""))

    return lines or None
