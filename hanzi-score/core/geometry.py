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
_TPL_SHORTLIST = 150      # 粗签名海选后进入精算的候选数

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
INK_MIN_RATIO = 0.002     # 墨迹像素占比低于 0.8% → too_faint
STROKE_ALIGN_GOOD = 0.9   # 单笔对齐率 ≥90% → 绿色（这一笔写到位了）
STROKE_ALIGN_PART = 0.6   # 60%~90% → 黄色（部分到位）；<60% → 红色（基本没写对）
NOISE_AREA = 0.00005 * GRID_SIZE * GRID_SIZE   # 小于它的连通域当噪点
LINE_THIN = 12            # 归一化后细于它的长直线当格线（笔画一般 15px 以上）
LINE_LONG = 0.85 * GRID_SIZE   # 长过它的细直线当格线
RED_KILL_FALLBACK = 0.2   # 剔红线后墨迹不足纯二值化的 20% → 认为误杀，回退

# 自适应格线/墨迹分离（_grid_line_mask、extract_ink 共用）：
# 比当地纸面暗 >18 算非纸面；暗 >55 且低饱和算手写墨迹；
# 真黑（gray<40）无条件算墨迹——暗部 HSV 的 S 是比值、黑像素会虚高
# 成 255 完全不可信，而暗红格线核心的 gray 通常 >60，不会误伤
DIFF_NOT_PAPER = 14
DIFF_INK = 48
INK_SAT_MAX = 70
GRAY_INK_MAX = 40

_CJK_RE = re.compile("[一-鿿]")

# hanzi-writer-data 实测是 **y 轴向上**，且基线不在画布底：数据 y ∈ [-124, 900]
# （基线 0、字高 900、下伸部 -124）。hanzi-writer 内部用 translate(0,900) scale(1,-1)
# 渲染，即 display_y = 900 - y。照搬 1024-y 会把整个字向下压约 12% 格宽
# （顶格的字如「汉」明显偏下）。加载时统一按 EM_BASELINE 翻成 y 向下。
DATA_Y_UP = True
EM_BASELINE = 900

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
                medians = [[[x, EM_BASELINE - y] for x, y in stroke]
                           for stroke in medians]
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


def _run_profile(mask):
    """mask 的每一列的最大连续 True 段长度（沿行方向累计，遇断归零）。

    用连续段而不是像素计数：实线外框的连续段接近整段跨度，而虚线中线
    的连续段只有一小截——两种线彻底分开。
    """
    h, w = mask.shape
    mask = (mask > 0).astype(np.int32)   # 兼容 0/255、bool、float 输入
    best = np.zeros(w, np.int32)
    prev = np.zeros(w, np.int32)
    for i in range(h):
        prev = (prev + 1) * mask[i]
        np.maximum(best, prev, out=best)
    return best


def _clean_mask(mask, min_px=16):
    """去掉碎小连通域（纸纹/噪点），保住格线段和虚线段。"""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask.astype(np.uint8), 8)
    keep = np.zeros(mask.shape, bool)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_px:
            keep[labels == i] = True
    return keep


def _line_positions(profile, length):
    """从 1D 红线投影里找线的位置：超阈值的索引聚簇取中心。

    返回 [(中心位置, 覆盖的索引列表), ...]。阈值 0.4×峰值：实线外框
    投影强；虚线中线连续段短，一般被排除，被遮挡裁切的边框也能留下。
    是否真是格线由 _find_cells_lines 按对角线特征二次判别。
    阴影边界形成的「宽线带」按簇的厚度过滤（真格线只有几个像素宽）。
    """
    if len(profile) == 0 or profile.max() <= 0:
        return []
    idxs = np.where(profile > 0.4 * profile.max())[0]
    if len(idxs) == 0:
        return []
    gap = max(3, length // 100)
    max_thick = max(8, length // 40)   # 斜拍会让线宽涨到 5~7px，别卡太紧
    groups, cur = [], [idxs[0]]
    for i in idxs[1:]:
        if i - cur[-1] <= gap:
            cur.append(i)
        else:
            groups.append(cur)
            cur = [i]
    groups.append(cur)
    return [(float(np.mean(g)), g) for g in groups
            if g[-1] - g[0] + 1 <= max_thick]


def _count_segments(flags):
    """1D 布尔序列里 True 段的个数。"""
    segs, prev = 0, False
    for f in flags:
        if f and not prev:
            segs += 1
        prev = bool(f)
    return segs


def _segment_lengths(flags):
    """1D 布尔序列里每个 True 段的长度列表。"""
    lengths, cur = [], 0
    for f in flags:
        if f:
            cur += 1
        elif cur:
            lengths.append(cur)
            cur = 0
    if cur:
        lengths.append(cur)
    return lengths


def _red_at(red, x, y, tol=3):
    """(x,y) 附近 tol 像素内是否有红线。"""
    h, w = red.shape
    xi, yi = int(round(x)), int(round(y))
    if xi < -tol or yi < -tol or xi >= w + tol or yi >= h + tol:
        return False
    y0, y1 = max(0, yi - tol), min(h, yi + tol + 1)
    x0, x1 = max(0, xi - tol), min(w, xi + tol + 1)
    return bool(red[y0:y1, x0:x1].any())


def _has_diagonal(red, px, py, extent):
    """点 (px,py) 处是否有对角线穿过（米字格中线的中点必被对角线穿过，
    边框线的中点不会）。沿两条 45° 方向各采 6 个距离，任一方向命中
    ≥2 档即算穿过（对角线未必严格 45°，且可能虚线化，容差随距离放宽）。"""
    hits1 = hits2 = 0
    for frac in (0.05, 0.08, 0.11, 0.14, 0.17, 0.20):
        d = int(extent * frac)
        if d < 5:
            continue
        tol = max(3, d // 5)
        if _red_at(red, px - d, py - d, tol) and _red_at(red, px + d, py + d, tol):
            hits1 += 1
        if _red_at(red, px - d, py + d, tol) and _red_at(red, px + d, py - d, tol):
            hits2 += 1
    return hits1 >= 2 or hits2 >= 2


def _segments_1d(flags):
    """1D 布尔序列的 True 段 [(起点, 终点), ...]（闭区间）。"""
    segs, start = [], None
    for i, f in enumerate(flags):
        if f and start is None:
            start = i
        elif not f and start is not None:
            segs.append((start, i - 1))
            start = None
    if start is not None:
        segs.append((start, len(flags) - 1))
    return segs


def _find_cells_lines(red, clusters, lo, hi, horizontal):
    """从候选线里去掉「中线」：中点（或任一红线段的中点）被对角线
    穿过的内部线是米字格中线；边框线的中点不会有对角线穿过。"""
    keep = []
    for center, idxs in clusters:
        band = red[idxs, :].any(axis=0) if horizontal else red[:, idxs].any(axis=1)
        on = band.nonzero()[0]
        if len(on) == 0:
            continue
        extent = on[-1] - on[0] + 1
        points = [(on[0] + on[-1]) / 2.0]
        for a, b in _segments_1d(band):
            if b - a >= 10:
                points.append((a + b) / 2.0)
        is_mid = False
        for mid in points:
            if horizontal:
                if _has_diagonal(red, mid, center, extent):
                    is_mid = True
                    break
            elif _has_diagonal(red, center, mid, extent):
                is_mid = True
                break
        if not is_mid:
            keep.append(center)
    return keep


def _grid_line_mask(bgr, k=None, th=None):
    """自适应「格线层」mask：格线 + 彩色批改笔痕，不含手写墨迹。

    用局部背景估计（闭运算把细线/笔画抹平得到当地纸面亮度）：
      - 比当地纸面暗一档（>th）：非纸面（格线、批改痕等）；
      - 其中又暗得多（>DIFF_INK）且低饱和的：手写墨迹（铅笔/中性笔），
        从格线层剔除——红格线饱和度高不会被误剔，灰格线只暗一档本来
        就不在墨迹里；真黑（gray<GRAY_INK_MAX）无条件算墨迹，暗部
        HSV 的 S 是比值、黑像素会虚高成 255 不可信。
    """
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    hsv_s = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1]
    if k is None:
        # 闭运算核要盖过笔画/虚线间隙，但别太大（大核很慢）
        k = min(101, max(31, (min(gray.shape) // 10) | 1))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    local_bg = cv2.morphologyEx(gray, cv2.MORPH_CLOSE, kernel)
    diff = local_bg.astype(np.int16) - gray.astype(np.int16)
    not_paper = diff > (DIFF_NOT_PAPER if th is None else th)
    ink = (diff > DIFF_INK) & ((hsv_s < INK_SAT_MAX) | (gray < GRAY_INK_MAX))
    return not_paper & ~ink


def _deskew_angle(mask):
    """从格线 mask 估计照片倾斜角（度）。用接近水平的 Hough 线段取中位角。"""
    lines = cv2.HoughLinesP(mask.astype(np.uint8) * 255, 1, np.pi / 180,
                            threshold=80,
                            minLineLength=mask.shape[1] // 5, maxLineGap=6)
    if lines is None:
        return 0.0
    angles = []
    for x1, y1, x2, y2 in lines[:, 0]:
        ang = np.degrees(np.arctan2(int(y2) - int(y1), int(x2) - int(x1)))
        if abs(ang) < 12:
            angles.append(ang)
    return float(np.median(angles)) if len(angles) >= 3 else 0.0


def _find_cells_once(bgr, th):
    """按给定「非纸面」阈值跑一遍完整分割，返回 cells 或 []。"""
    try:
        h_full, w_full = bgr.shape[:2]
        # 只对很大的照片缩放（≤2000px 原样处理：缩放会把虚线中线
        # 糊成连续浅线，导致整格被中线劈开）
        scale = min(1.0, 2000.0 / max(h_full, w_full))
        if scale < 1.0:
            small = cv2.resize(bgr, None, fx=scale, fy=scale,
                               interpolation=cv2.INTER_AREA)
        else:
            small = bgr
        mask = _grid_line_mask(small, th=th)
        if int(mask.sum()) < 30:
            return []
        mask = _clean_mask(mask)
        if int(mask.sum()) < 30:
            return []
        # 旋正：斜拍会让投影里的整条线摊到相邻几行/列，先转回来。
        # 小角度不值得转——NEAREST 旋转会把细线打断成锯齿
        angle = _deskew_angle(mask)
        h_s, w_s = small.shape[:2]
        if abs(angle) > 1.5:
            c, s = abs(np.cos(np.radians(angle))), abs(np.sin(np.radians(angle)))
            nw, nh = int(w_s * c + h_s * s), int(w_s * s + h_s * c)
            M = cv2.getRotationMatrix2D((w_s / 2.0, h_s / 2.0), angle, 1.0)
            M[0, 2] += (nw - w_s) / 2.0
            M[1, 2] += (nh - h_s) / 2.0
            work_img = cv2.warpAffine(small, M, (nw, nh))
            work_mask = cv2.warpAffine(mask.astype(np.uint8) * 255, M, (nw, nh),
                                       flags=cv2.INTER_NEAREST)
            work = work_mask > 0
            M_inv = cv2.invertAffineTransform(M)   # 工作图坐标 → small 坐标
        else:
            work_img, work = small, mask
            M_inv = None
        red = work
        if int(red.sum()) < 30:
            return []
        h_img, w_img = work.shape[:2]
        min_side = 0.04 * min(w_img, h_img)   # 格子最小边，滤掉细碎噪声

        xclusters = _line_positions(_run_profile(red), w_img)
        yclusters = _line_positions(_run_profile(red.T), h_img)
        # 图像最边缘的候选线多为暗边/阴影边界，不是格线，丢弃
        edge = max(3, int(0.015 * max(w_img, h_img)))
        xclusters = [(c, i) for c, i in xclusters if edge < c < w_img - edge]
        yclusters = [(c, i) for c, i in yclusters if edge < c < h_img - edge]
        # 去掉内部中线：中点被对角线穿过的候选线（用另一轴的外沿做跨度）
        if xclusters and yclusters:
            ys_all = [c for c, _ in yclusters]
            xs_all = [c for c, _ in xclusters]
            xs = _find_cells_lines(red, xclusters, min(ys_all), max(ys_all),
                                   horizontal=False)
            ys = _find_cells_lines(red, yclusters, min(xs), max(xs),
                                   horizontal=True)
        else:
            xs, ys = [], []

        cells = _cells_from_lines(xs, ys, min_side, dims=(w_img, h_img))
        if not cells:
            return []
        # 工作图坐标 → 缩放图坐标 → 原图坐标
        if M_inv is not None:
            cells = [cv2.transform(c.reshape(-1, 1, 2), M_inv).reshape(-1, 2)
                     for c in cells]
        if scale < 1.0:
            inv = 1.0 / scale
            cells = [c * inv for c in cells]
        return cells
    except Exception:
        return []


def _fill_gaps(lines, dims_limit=None):
    """局部补漏检的格线：相邻两线间距约等于 2 倍（或更多倍）中位间距时，
    在中间按等分插值补线。练习本页面常有弧度（书脊处行距变窄），
    不能整页拉等差网格，只在确实漏线的地方局部补。"""
    if len(lines) < 2:
        return list(lines)
    med = float(np.median(np.diff(lines)))
    if med <= 0:
        return list(lines)
    out = []
    for a, b in zip(lines, lines[1:]):
        out.append(float(a))
        steps = int(round((b - a) / med))
        for k in range(1, steps):
            out.append(a + k * (b - a) / steps)
    out.append(float(lines[-1]))
    if dims_limit is not None:
        if out[0] - med > 0.04 * dims_limit:
            out.insert(0, out[0] - med)
        if out[-1] + med < dims_limit - 0.04 * dims_limit:
            out.append(out[-1] + med)
    return out


def _cells_from_lines(xs, ys, min_side, dims=None):
    """把同轴的格线位置配对成格子：相邻间距接近中位数（±40%）才算一对，
    行内格宽和格高再互相卡一次方正度。返回工作坐标系的四角点列表。

    dims=(w, h) 时先局部补齐漏检的线（页面有弧度时不能整页拉等差）。"""
    if dims:
        xs = _fill_gaps(xs, dims[0])
        ys = _fill_gaps(ys, dims[1])

    def _pairs(lines):
        if len(lines) < 2:
            return []
        diffs = np.diff(lines)
        med = float(np.median(diffs))
        if med < min_side:
            return []
        return [(lines[i], lines[i + 1]) for i in range(len(lines) - 1)
                if 0.6 * med <= diffs[i] <= 1.6 * med]

    xpairs = _pairs(xs)
    ypairs = _pairs(ys)
    if not xpairs or not ypairs:
        return []
    xw = float(np.median([b - a for a, b in xpairs]))
    yh = float(np.median([b - a for a, b in ypairs]))
    lo, hi = 0.6 * min(xw, yh), 1.6 * max(xw, yh)
    xpairs = [p for p in xpairs if lo <= p[1] - p[0] <= hi]
    ypairs = [p for p in ypairs if lo <= p[1] - p[0] <= hi]
    cells = []
    for y1, y2 in ypairs:
        for x1, x2 in xpairs:
            quad = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], np.float32)
            cells.append(_order_quad(quad))
    if len(cells) > 200:      # 防御：检出几百个"格子"说明照片不对劲
        return []
    return cells


def _find_lines_hough(gray):
    """Canny + HoughLinesP 直接找格线。纸面颗粒重、格线极淡的照片，
    亮度阈值法会溺水（颗粒和线亮度重叠），而边缘图里颗粒根本成不了
    长直线。返回实线边框的 (xs, ys) 位置；虚线中线按「沿线边缘段数
    多而碎」剔除。"""
    h, w = gray.shape[:2]
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), 40, 120)
    min_len = int(0.35 * min(h, w))
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=max(30, min_len // 2),
                            minLineLength=min_len, maxLineGap=15)
    if lines is None:
        return [], []
    hs, vs = [], []
    for x1, y1, x2, y2 in lines[:, 0]:
        ang = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if abs(ang) < 4:
            hs.append((y1 + y2) / 2.0)
        elif abs(abs(ang) - 90) < 4:
            vs.append((x1 + x2) / 2.0)
    gap = max(6, min(h, w) // 50)

    def _cluster(vals):
        vals = sorted(vals)
        out = []
        for v in vals:
            if out and v - out[-1][-1] <= gap:
                out[-1].append(v)
            else:
                out.append([v])
        return [float(np.mean(g)) for g in out]

    def _solid(positions, horizontal):
        # 沿候选线统计边缘像素段：实线边框段少且长（≤3 段），
        # 虚线中线段多而碎，丢弃
        keep = []
        for pos in positions:
            lo = max(0, int(pos) - 2)
            if horizontal:
                trace = edges[lo:int(pos) + 3, :].any(axis=0)
            else:
                trace = edges[:, lo:int(pos) + 3].any(axis=1)
            on = trace.nonzero()[0]
            if len(on) == 0:
                continue
            segs = np.split(on, np.nonzero(np.diff(on) > 4)[0] + 1)
            if sum(1 for s in segs if len(s) >= 8) <= 3:
                keep.append(pos)
        return keep

    return _solid(_cluster(vs), False), _solid(_cluster(hs), True)


def _find_cells_hough(bgr):
    """分割阶梯的兜底档：亮度阈值法全部失败时用边缘检测找线。"""
    try:
        h, w = bgr.shape[:2]
        scale = min(1.0, 1000.0 / max(h, w))
        if scale < 1.0:
            small = cv2.resize(bgr, None, fx=scale, fy=scale,
                               interpolation=cv2.INTER_AREA)
        else:
            small = bgr
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        xs, ys = _find_lines_hough(gray)
        # 覆盖率校验：真格线在「剔除了墨迹的格线 mask」上连续可见，
        # 字的笔画（横竖撇捺）不在——否则单格大字会被拆成假格子
        try:
            gmask = _grid_line_mask(small)
            def _covered(positions, horizontal):
                keep = []
                for pos in positions:
                    p = int(round(pos))
                    if horizontal:
                        trace = gmask[max(0, p - 2):p + 3, :].any(axis=0)
                    else:
                        trace = gmask[:, max(0, p - 2):p + 3].any(axis=1)
                    on = trace.nonzero()[0]
                    cov = float(len(on)) / float(len(trace))
                    if cov >= 0.15:
                        keep.append(pos)
                return keep
            xs = _covered(xs, False)
            ys = _covered(ys, True)
        except Exception:
            pass
        if len(xs) < 2 or len(ys) < 2:
            return []
        min_side = 0.04 * min(gray.shape[:2])
        gh, gw = gray.shape[:2]
        cells = _cells_from_lines(xs, ys, min_side, dims=(gw, gh))
        if scale < 1.0:
            cells = [c / scale for c in cells]
        return cells
    except Exception:
        return []


def find_cells(bgr):
    """从整张照片里找出所有田字格，按阅读顺序（先上后下、行内从左到右）排列。

    格线 mask 用 _grid_line_mask 自适应（红格/灰格/绿格本都行）。照片
    略斜时先用 Hough 估计角度旋正再投影找线，最后把四角点按逆变换
    映射回原图坐标。相邻格线的间距接近中位数的才算格子边界，这样
    共享边框的并排格、多行格、整页格子都能切开。
    「非纸面」阈值走阶梯：干净照片用标准值，暗淡/低对比的照片逐级
    放宽重试（阈值越低噪声越多，只在上一级失败时才降）。亮度阈值
    全部失败时最后用 Canny+Hough 找线兜底（纸面颗粒重、格线极淡的
    照片靠边缘检测绕开亮度重叠）。
    返回四角点列表（每个 4×2 float32），找不到返回 []。
    """
    for th in (18, 14, 10):
        cells = _find_cells_once(bgr, th)
        if cells:
            return _extend_lattice(cells, bgr.shape[0], bgr.shape[1])
    return _extend_lattice(_find_cells_hough(bgr),
                           bgr.shape[0], bgr.shape[1])


def crop_quad(bgr, quad, margin=0.08):
    """按角点外接框（四周外扩 margin）裁出格子子图，供逐格走单格流水线。"""
    x, y, w, h = cv2.boundingRect(np.asarray(quad, np.float32))
    mx, my = int(w * margin), int(h * margin)
    x0, y0 = max(0, x - mx), max(0, y - my)
    x1 = min(bgr.shape[1], x + w + mx)
    y1 = min(bgr.shape[0], y + h + my)
    return bgr[y0:y1, x0:x1]


def _find_cell_from_mask(mask, size, adaptive=False):
    """从格线 mask 的最大连通域提取外框四角点（poly 优先，退 minAreaRect）。

    adaptive=True（灰格练习本的回退路径）时额外做合理性校验：
    外框应接近方形（长宽比 0.5~2.0）、面积占图的 8%~85%——防止把
    阴影边界或整页暗区当成格子。
    """
    mask = (mask > 0).astype(np.uint8)   # countNonZero 不认 bool
    if cv2.countNonZero(mask) < 0.005 * mask.size:
        return None
    closed = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE,
                              np.ones((9, 9), np.uint8))
    n, labels = cv2.connectedComponents(closed, 8)
    if n < 2:
        return None
    counts = np.bincount(labels.ravel())
    counts[0] = 0
    idx = int(np.argmax(counts))
    total = cv2.countNonZero(mask)
    if counts[idx] < 0.5 * total:     # 最大的那个连通域得吃掉大部分格线
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
            cv2.contourArea(approx) > 0.3 * mask.size:
        quad = _order_quad(approx.reshape(4, 2))
    else:
        rect = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rect)
        if cv2.contourArea(box) <= 0.3 * mask.size:
            return None
        quad = _order_quad(box)
    if adaptive:
        x, y, w, h = cv2.boundingRect(quad.astype(np.float32))
        if not (0.5 <= w / float(h) <= 2.0):
            return None
        if not (0.08 * size[0] * size[1] <= w * h <= 0.85 * size[0] * size[1]):
            return None
    return {"quad": quad, "method": "poly"}


def find_cell(bgr):
    """检测单格田字格外框。返回 {"quad","method"}，不是田字格照片返回 None。

    优先红格线（历史主路径）；红色像素太少时按自适应格线层重试
    （灰格/黑格练习本）。格线层里虚线中线会和外框连成一个连通域，
    没关系——取最大连通域的外轮廓，包住它的仍然是外框四边形。
    """
    red = _red_mask(bgr)
    if cv2.countNonZero(red) >= 0.005 * red.size:
        return _find_cell_from_mask(red > 0, bgr.shape[:2])
    for th in (18, 14, 10):
        gmask = _clean_mask(_grid_line_mask(bgr, th=th))
        result = _find_cell_from_mask(gmask, bgr.shape[:2], adaptive=True)
        if result:
            return result
    return None


def warp_to_cell(bgr, quad, size=GRID_SIZE):
    """把四角围出的格子透视归一到 size×size（y 向下，与标准字坐标系一致）。"""
    dst = np.array([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]],
                   np.float32)
    mat = cv2.getPerspectiveTransform(np.asarray(quad, np.float32), dst)
    return cv2.warpPerspective(bgr, mat, (size, size))


def cell_has_ink(bgr, quad):
    """廉价预筛：256px 缩样上跑 extract_ink 的同款小号流水线。

    整页练习纸里大量空格（空行/词间空列），逐格走完整流水线太浪费。
    必须和 extract_ink 同款（Sauvola + 剔红线 + 剔浅格线），否则粗筛
    会在极淡铅笔字上漏检（multi04：diff 全程 <40，粗筛全判空）——
    保证「预筛说有，完整管线就一定有」。
    """
    try:
        small = warp_to_cell(bgr, quad, size=256)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        from skimage.filters import threshold_sauvola
        thresh = threshold_sauvola(gray, window_size=15, k=0.2)
        binary = ((gray < thresh) * 255).astype(np.uint8)
        red = _red_mask(small)
        if cv2.countNonZero(red):
            binary = cv2.bitwise_and(
                binary, cv2.bitwise_not(cv2.dilate(red, np.ones((3, 3), np.uint8))))
        # 剔格线：格线只比当地纸面暗一档（与 extract_ink 的 DIFF_INK 滤波同款）
        local_bg = cv2.dilate(gray, np.ones((39, 39), np.uint8))
        keep = (local_bg.astype(np.int16) - gray.astype(np.int16)) > DIFF_INK
        binary = cv2.bitwise_and(binary, (keep * 255).astype(np.uint8))
        inner = binary[64:192, 64:192]
        return float(cv2.countNonZero(inner)) > 0.0018 * inner.size
    except Exception:
        return True    # 预筛失败不放过，交给完整管线判断


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

    # 局部对比度剔灰格线：灰线只比当地纸面暗一档（< DIFF_INK），
    # 手写墨迹暗得多。纸面亮度用 dilate（局部最大）估计——闭运算的
    # 核若不比笔画宽，会陷进粗笔画内部把真墨迹误判成「浅」。
    # 在 1/4 尺度上算再放大（等效核 151/4≈38），大核 dilate 太慢
    small = cv2.resize(gray, (256, 256), interpolation=cv2.INTER_AREA)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (39, 39))
    local_bg = cv2.resize(cv2.dilate(small, kernel),
                          (gray.shape[1], gray.shape[0]),
                          interpolation=cv2.INTER_LINEAR)
    faint = ((local_bg.astype(np.int16) - gray.astype(np.int16)) < DIFF_INK)
    cleaned = cv2.bitwise_and(binary, (~faint).astype(np.uint8) * 255)
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


_OCR_MIN_CONF = 0.5      # OCR 置信度低于它时，认字结果里补充模板匹配候选
_OCR_ACCEPT = 0.35       # 置信度低于它才真正跑模板兜底（模板打全库较慢）
_OCR_EARLY_EXIT = 0.7    # 候选输入里已经拿到这个置信度就不用再试下一路
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

    喂给比对/展示用的干净字块。OCR 的输入走 _ocr_crops（真实灰度
    纹理的信息量远高于二值 mask，实测置信度 0.99 vs 0.42）。
    """
    region = _ink_region(warped, ink, margin)
    if region is None:
        return None
    x0, y0, x1, y1 = region
    crop = warped[y0:y1 + 1, x0:x1 + 1]
    clean = np.full_like(crop, 255)
    clean[ink[y0:y1 + 1, x0:x1 + 1] > 0] = (40, 40, 40)
    side = max(clean.shape[:2])
    pad = np.full((side, side, 3), 255, np.uint8)
    oy, ox = (side - clean.shape[0]) // 2, (side - clean.shape[1]) // 2
    pad[oy:oy + clean.shape[0], ox:ox + clean.shape[1]] = clean
    return cv2.resize(pad, (size, size))


def _ink_region(warped, ink, margin=0.2):
    """墨迹的外接框（带 margin，裁到图内）。没有墨迹返回 None。"""
    ys, xs = np.nonzero(ink > 0)
    if len(xs) == 0:
        return None
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    m = int(margin * max(x1 - x0, y1 - y0))
    h, w = warped.shape[:2]
    return max(0, x0 - m), max(0, y0 - m), min(w, x1 + m), min(h, y1 + m)


def _ocr_crops(warped, ink):
    """OCR 识别模型的输入候选，按优先级排列：

    1. 对比度归一的灰度字块（256px）——保留真实笔触浓淡，实测对
       淡铅笔字的置信度 ~0.99，远高于二值 mask 的 ~0.4
    2. 墨迹掩码定向拉伸的灰度（256px）——极淡铅笔字的笔画和纸面
       只差十几个灰阶，整体 MINMAX 归一救不动；按掩码把
       [笔画灰度, 纸面灰度] 区间拉满到 [0,255]，对比度放大数倍
    3. 墨迹 mask 平滑加粗版（128px）——灰度不可靠（彩色纸/阴影重）
       时的兜底；先高斯再阈值去低分辨率锯齿，dilate 恢复笔画重量
    """
    region = _ink_region(warped, ink)
    if region is None:
        return []
    x0, y0, x1, y1 = region
    crops = []
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)[y0:y1 + 1, x0:x1 + 1]
    mask = ink[y0:y1 + 1, x0:x1 + 1] > 0
    side = max(gray.shape)
    oy, ox = (side - gray.shape[0]) // 2, (side - gray.shape[1]) // 2
    padg = np.full((side, side), 255, np.uint8)
    padg[oy:oy + gray.shape[0], ox:ox + gray.shape[1]] = gray
    norm = cv2.normalize(padg, None, 0, 255, cv2.NORM_MINMAX)
    crops.append(("gray", cv2.resize(norm, (256, 256))))
    if mask.sum() >= 30:
        gf = gray.astype(np.float32)
        paper = float(np.median(gf[~mask]))
        inkv = float(np.percentile(gf[mask], 30))
        if paper - inkv >= 5:
            stretch = np.clip((gf - inkv) / max(1.0, paper - inkv) * 255,
                              0, 255).astype(np.uint8)
            pads = np.full((side, side), 255, np.uint8)
            pads[oy:oy + stretch.shape[0], ox:ox + stretch.shape[1]] = stretch
            crops.append(("stretch", cv2.resize(pads, (256, 256))))
    padm = np.zeros((side, side), np.uint8)
    padm[oy:oy + mask.shape[0], ox:ox + mask.shape[1]] = (
        mask.astype(np.uint8) * 255)
    blur = cv2.GaussianBlur(padm, (5, 5), 0)
    smooth = ((blur > 100) * 255).astype(np.uint8)
    thick = cv2.dilate(smooth, np.ones((5, 5), np.uint8))
    crops.append(("mask", cv2.resize(thick, (128, 128))))
    return crops


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
            # 逐个候选输入尝试，保留置信度最高的；conf 够高就提前收工
            for _name, crop in _ocr_crops(warped, ink_mask):
                res, _ = ocr(crop, use_det=False, use_cls=False, use_rec=True)
                if not res:
                    continue
                text, conf = res[0][0], float(res[0][1])
                # 破折号/片假名这类 OCR 常见误认，换回汉字「一」
                if text in ("—", "—", "ー", "－"):
                    text = "一"
                mm = _CJK_RE.search(text or "")
                if not mm:
                    continue
                ch = mm.group(0)
                if not results or conf > results[0]["score"]:
                    results.insert(0, {"char": ch, "score": round(conf, 4),
                                       "source": "ocr"})
                seen.add(ch)
                if results[0]["score"] >= _OCR_EARLY_EXIT:
                    break

        if not results or results[0]["score"] < _OCR_MIN_CONF:
            # OCR 结果太差才走模板兜底。但 OCR 置信度 ≥ _OCR_ACCEPT 时的
            # 「直接采用」结果已经够用——模板打全库要 1 秒多，整页几十格
            # 时会把响应拖到几十秒
            if not results or results[0]["score"] < _OCR_ACCEPT:
                for cand in recognize_char_by_template(ink_mask, top_n=top_n):
                    if cand["char"] not in seen:
                        results.append(cand)
                        seen.add(cand["char"])

        return results[:top_n] or None
    except Exception:
        return None


def _tpl_signature(tpl):
    """模板的 16×16 粗签名：3500 个候选先用它海选，只对最像的前
    _TPL_SHORTLIST 个做精细 chamfer/IoU（那一步是纯 Python，占 GIL，
    逐格打分的并行瓶颈就在这）。"""
    return cv2.resize(tpl, (16, 16), interpolation=cv2.INTER_AREA)


def recognize_char_by_template(ink_mask, top_n=5):
    """模板匹配认字（OCR 的兜底）：手写墨迹 vs 标准字库。

    score 是相似度（0~1，越大越像）。首次调用要渲染整个候选池（几秒），之后走缓存。
    """
    global _template_cache
    try:
        ink64 = _norm_blob(ink_mask)
        if ink64 is None or cv2.countNonZero(ink64) < 16:
            return []
        ink_sig = _tpl_signature(ink64).astype(np.float32) / 255.0
        ink_pts = np.column_stack(np.nonzero(ink64 > 0))[:, ::-1].astype(np.float32)
        dt_ink = _dt_of(ink64)
        ink_d = cv2.dilate(ink64, np.ones((3, 3), np.uint8))

        # 第一遍：粗签名海选（纯向量化，3500 字 ~毫秒级）
        coarse = []
        for char in _charset():
            if char not in _template_cache:
                std = load_standard(char)
                if not std:
                    _template_cache[char] = None
                else:
                    m = render_standard_mask(std["medians"], size=_RECOGNIZE_RENDER,
                                             width=max(2, _RECOGNIZE_RENDER // 24))
                    tpl = _norm_blob(m)
                    if tpl is None:
                        _template_cache[char] = None
                    else:
                        # 距离变换/膨胀/粗签名只算一次存进缓存，多次认字时复用
                        _template_cache[char] = (tpl, _dt_of(tpl),
                                                 cv2.dilate(tpl, np.ones((3, 3), np.uint8)),
                                                 _tpl_signature(tpl).astype(np.float32) / 255.0)
            entry = _template_cache[char]
            if entry is None or cv2.countNonZero(entry[0]) < 8:
                continue
            dist = float(np.abs(entry[3] - ink_sig).sum())
            coarse.append((dist, char))
        coarse.sort(key=lambda p: p[0])

        # 第二遍：只对最像的短名单做精细打分
        scored = []
        for _, char in coarse[:_TPL_SHORTLIST]:
            tpl, dt_std, tpl_d, _sig = _template_cache[char]
            std_pts = np.column_stack(np.nonzero(tpl > 0))[:, ::-1].astype(np.float32)
            # 对称 chamfer（平均每点离对方笔画的距离 / 64）
            d1 = float(dt_ink[std_pts[:, 1].astype(int), std_pts[:, 0].astype(int)].mean())
            d2 = float(dt_std[ink_pts[:, 1].astype(int), ink_pts[:, 0].astype(int)].mean())
            chamfer = 0.5 * (d1 + d2) / _RECOGNIZE_SIZE
            # 形状重合率：互相膨胀后算 IoU，字库里形状相近的字靠它分开
            inter = cv2.countNonZero(cv2.bitwise_and(ink_d, tpl_d))
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
            n = len(d)
            total_pts += n
            hit = int((d < COVER_DIST).sum())
            covered_pts += hit
            strokes.append({
                "index": idx,
                "mean_off": round(mean_d, 4),
                # 对齐率：这一笔中线点里落在手写墨迹附近的比例，喂给叠加图配色
                "align_ratio": round(hit / max(1, n), 4),
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


def _ink_overflow(ink):
    """墨迹是否贴到归一化图边缘（外圈 3% 有墨 = 字被格子切了）。
    返回 (左, 右, 上, 下) 布尔。"""
    size = ink.shape[0]
    band = max(8, int(size * 0.03))
    inked = ink > 0
    area = max(1, inked.sum())
    left = inked[:, :band].sum() > area * 0.06
    right = inked[:, -band:].sum() > area * 0.06
    top = inked[:band, :].sum() > area * 0.06
    bottom = inked[-band:, :].sum() > area * 0.06
    return left, right, top, bottom


def _grow_quad(quad, need):
    """按 (左,右,上,下) 需求把四边形向外扩 30%（图像范围内由 warp 裁剪）。"""
    quad = quad.astype(np.float64).copy()
    left, right, top, bottom = need
    cx, cy = quad[:, 0].mean(), quad[:, 1].mean()
    for i in range(4):
        x, y = quad[i]
        if left and x < cx:
            quad[i, 0] = cx - (cx - x) * 1.3
        if right and x > cx:
            quad[i, 0] = cx + (x - cx) * 1.3
        if top and y < cy:
            quad[i, 1] = cy - (cy - y) * 1.3
        if bottom and y > cy:
            quad[i, 1] = cy + (y - cy) * 1.3
    return quad.astype(np.float32)


def _extend_lattice(cells, img_h, img_w):
    """等距练习本的边缘行漏检时向外延一步（多04：第一行整行漏检）。

    只延一步、只延纵向；延出来的空格由 cell_has_ink 预筛过滤，不会
    把桌面/纸边当成格子。
    """
    if not cells or len(cells) < 4:
        return cells
    h = float(np.median([q[:, 1].max() - q[:, 1].min() for q in cells]))
    if h < 0.05 * img_h:
        return cells
    out = list(cells)
    top = min(q[:, 1].min() for q in cells)
    bottom = max(q[:, 1].max() for q in cells)
    top_row = [q for q in cells if abs(q[:, 1].min() - top) < h * 0.3]
    bottom_row = [q for q in cells if abs(q[:, 1].max() - bottom) < h * 0.3]
    if top - h >= 0.005 * img_h:
        out.extend(q + np.array([0, -h], np.float32) for q in top_row)
    if bottom + h <= 0.98 * img_h:
        out.extend(q + np.array([0, h], np.float32) for q in bottom_row)
    return out


def count_cells(source):
    """轻量入口：这张照片里有几个田字格（不逐格打分）。"""
    try:
        img = _load_source(source)
        if img is None:
            return 0
        return len(find_cells(img))
    except Exception:
        return 0


def correct_page(bgr):
    """整页纠偏：先跑一遍格子分割，取所有格子的外扩外框做透视拉正。

    返回 (拉正图, 映射后的格子四边形列表, 是否发生了纠偏)。
    格子不重新分割——原始四边形经同一变换矩阵映射，位置不会错。
    """
    try:
        cells = find_cells(bgr)
        if len(cells) < 1:
            return bgr, [], False
        pts = np.vstack([np.asarray(q, np.float32) for q in cells]).astype(np.float32)
        hull = cv2.convexHull(pts)
        approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True)
        if len(approx) == 4:
            quad = approx.reshape(4, 2).astype(np.float32)
        else:
            quad = cv2.boxPoints(cv2.minAreaRect(pts)).astype(np.float32)
        quad = _order_quad(quad)
        center = pts.mean(axis=0)
        quad = center + (quad - center) * 1.04   # 外扩一点，把最外圈格线包进来
        warped, M = warp_page(bgr, quad)
        if len(cells) == 1:
            dh, dw = warped.shape[:2]
            mapped = [np.array([[0, 0], [dw, 0], [dw, dh], [0, dh]], np.float32)]
        else:
            mapped = []
            for q in cells:
                q4 = np.asarray(q, np.float32).reshape(-1, 2)[:4]
                mapped.append(
                    cv2.perspectiveTransform(q4.reshape(-1, 1, 2), M)
                    .reshape(4, 2))
        return warped, mapped, True
    except Exception:
        return bgr, [], False


def find_page_quad(bgr):
    """找整页的外框四角（纸张边缘或最外圈格线），用于整页透视拉正。

    找不到（太斜/线太淡/面积不够）返回 None，调用方退回原图。
    """
    try:
        mask = _clean_mask(_grid_line_mask(bgr))
        mask_u8 = mask.astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL,
                                       cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None
        h, w = bgr.shape[:2]
        contour = max(contours, key=cv2.contourArea)
        if cv2.contourArea(contour) < 0.15 * w * h:
            return None
        return _quad_from_contour(contour, 0.3 * w * h)
    except Exception:
        return None


def warp_page(bgr, quad, max_side=1400):
    """整页按外框四角透视拉正（保持长宽比，最长边不超过 max_side）。

    返回 (拉正图, 变换矩阵 M)：原始坐标 -> 拉正坐标。
    """
    quad = _order_quad(np.asarray(quad, np.float32))
    xs, ys = quad[:, 0], quad[:, 1]
    w = float(xs.max() - xs.min())
    h = float(ys.max() - ys.min())
    scale = min(1.0, max_side / max(w, h, 1.0))
    dw, dh = max(32, int(round(w * scale))), max(32, int(round(h * scale)))
    dst = np.array([[0, 0], [dw, 0], [dw, dh], [0, dh]], np.float32)
    M = cv2.getPerspectiveTransform(quad, dst)
    return cv2.warpPerspective(bgr, M, (dw, dh)), M


def extract(source, char=None, quad=None):
    """总入口：照片（bytes/路径）→ 几何指标。永不抛异常。

    quad 给了就跳过找框直接用（多格分割的每一格），否则单格自动检测。
    认字总是跑（OCR 便宜且没有 LLM 兜底了）：char 给了就当比对参考
    （ref_char），照片里实际写的字以 OCR 为准（char）；char 没给则
    ref_char = OCR 认出的最像的字。
    返回：
      成功 {"ok":True, "char":OCR认出的字, "ref_char":比对参考字,
            "metrics":…, "lines":[…], "recognized":[…],
            "warped":ndarray, "ink":ndarray}
      失败 {"ok":False, "reason":"no_cell|too_faint|error", "detail":…}
    """
    try:
        img = _load_source(source)
        if img is None:
            return {"ok": False, "reason": "error", "detail": "图片读不开"}
        if quad is not None:
            cell = {"quad": np.asarray(quad, np.float32), "method": "given"}
        else:
            cell = find_cell(img)
            if cell is None:
                return {"ok": False, "reason": "no_cell", "detail": "没找到田字格外框"}
        warped = warp_to_cell(img, cell["quad"])
        ink = extract_ink(warped)
        # 页面弧度/斜拍会让字骑在格子边界上被切掉一角，OCR/比对都废。
        # 墨迹贴边（外圈 3% 有墨）就向该方向扩格重切，至多两轮。
        quad_f = np.asarray(cell["quad"], np.float32)
        for _ in range(2):
            need = _ink_overflow(ink)
            if not any(need):
                break
            quad_f = _grow_quad(quad_f, need)
            warped = warp_to_cell(img, quad_f)
            ink = extract_ink(warped)
        if cv2.countNonZero(ink) < INK_MIN_RATIO * ink.size:
            return {"ok": False, "reason": "too_faint", "detail": "笔迹太淡或没写到"}

        recognized = recognize_char(ink, warped=warped) or []
        ocr_char = recognized[0]["char"] if recognized else None
        ref_char = char if (char and load_standard(char)) else ocr_char
        std = load_standard(ref_char)

        metrics = compare(ink, render_standard_mask(std["medians"]) if std else None,
                          std["medians"] if std else None,
                          std["stroke_count"] if std else None)
        metrics["quality"] = _quality(metrics)
        lines = summarize_text(metrics, ref_char, recognized)

        return {
            "ok": True,
            "char": ocr_char,
            "ref_char": ref_char,
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


# ---------------------------------------------------------------- SVG 轮廓渲染

def sample_svg_strokes(strokes, samples_per_curve=32):
    """把 Make-me-a-Hanzi 的 SVG 路径（M/L/Q/C/Z 绝对命令）采样成多边形点列。

    Q/C 是贝塞尔曲线，按参数均匀采样；Z 闭合回起点。返回 [np.ndarray(N,2)]，
    坐标仍是原始 1024 空间（含 y 向上问题，由调用方翻转）。
    """
    polys = []
    cur = start = None
    for cmd, args in re.findall(r"([MLQCZ])([^MLQCZ]*)", "".join(strokes)):
        nums = [float(v) for v in re.findall(r"-?\d+\.?\d*", args)]
        if cmd == "M":
            cur = np.array(nums[:2])
            start = cur
            polys.append([cur])
        elif cmd in "LQC" and cur is not None and polys:
            pts = np.array(nums).reshape(-1, 2)
            if cmd == "L":
                for p in pts:
                    polys[-1].append(p)
                cur = pts[-1]
            else:
                k = 2 if cmd == "Q" else 3
                for i in range(0, len(pts), k):
                    c = pts[i:i + k]
                    t = np.linspace(0, 1, samples_per_curve)[:, None]
                    if len(c) == 2:
                        seg = (1 - t) ** 2 * cur + 2 * (1 - t) * t * c[0] + t ** 2 * c[1]
                    else:
                        seg = ((1 - t) ** 3 * cur + 3 * (1 - t) ** 2 * t * c[0]
                               + 3 * (1 - t) * t ** 2 * c[1] + t ** 3 * c[2])
                    polys[-1].extend(seg)
                    cur = c[-1]
        elif cmd == "Z" and polys:
            polys[-1].append(start)
            cur = start
    return [np.array(p) for p in polys if len(p) >= 3]


def _polys_scaled(polys, size):
    """多边形缩放到 size×size（含 y 翻转，落成 y 向下画布坐标）。"""
    scale = size / float(GRID_SIZE)
    out = []
    for poly in polys:
        p = poly.astype(np.float64).copy()
        p[:, 1] = EM_BASELINE - p[:, 1]      # 数据 y 向上、基线 900 → 翻成 y 向下
        out.append((p * scale).astype(np.int32))
    return out


def render_standard_filled(strokes, size=GRID_SIZE):
    """按 SVG 轮廓路径把标准字填充渲染成 uint8 mask（0/255）。

    和 hanzi-writer/preview.html 的画法一致（书法字形：撇尖捺展、粗细有变化），
    比 medians 加粗折线好看得多。strokes 为空返回全 0。
    """
    canvas = np.zeros((size, size), np.uint8)
    for poly in _polys_scaled(sample_svg_strokes(strokes), size):
        cv2.fillPoly(canvas, [poly], 255)
    return canvas


def _measure_stroke_width(ink):
    """从手写墨迹估笔画宽（各连通域距离变换最大值×2 的中位数），量不出返回 None。"""
    if ink is None or not cv2.countNonZero(ink):
        return None
    try:
        dt = cv2.distanceTransform(ink, cv2.DIST_L2, 3)
        _, labels, stats, _ = cv2.connectedComponentsWithStats(ink, 8)
        widths = [float(dt[labels == i].max()) * 2
                  for i in range(1, len(stats)) if stats[i, cv2.CC_STAT_AREA] > 0]
        widths = [w for w in widths if w > 0]
        return int(round(float(np.median(widths)))) if widths else None
    except Exception:
        return None


def _stroke_color_name(align):
    """按单笔对齐率给档位名：≥90% 绿、60%~90% 黄、<60% 红，量不出 None（中性浅灰）。"""
    if align is None:
        return None
    if align >= STROKE_ALIGN_GOOD:
        return "green"
    if align >= STROKE_ALIGN_PART:
        return "yellow"
    return "red"


_STROKE_LAYER_BGR = {
    "green": (170, 230, 170),
    "yellow": (150, 230, 255),
    "red": (140, 140, 255),
    "none": (200, 200, 200),
}


def _encode_rgba(rgba):
    ok, buf = cv2.imencode(".png", rgba)
    return buf.tobytes() if ok else None


def build_overlay_pngs(warped, std, ink=None, stroke_scores=None):
    """对比图拆成多层 PNG（全部 1024×1024，可叠放），前端用 CSS 叠加并按色筛选。

    返回 dict：
      grid   米字格底板 + 没量出对齐率的笔画（浅灰），不透明
      green/yellow/red  对齐档位对应的笔画填充（透明底 RGBA，无则 None）
      green_cl/yellow_cl/red_cl  同档位笔画的标准中线（叠在手写上面，无则 None）
      ink    黑色手写笔迹 + 没分档笔画的中线（透明底 RGBA）
    """
    try:
        medians = (std or {}).get("medians") or []
        strokes = (std or {}).get("strokes") or []

        grid = draw_rice_grid()
        ink_layer = np.zeros((GRID_SIZE, GRID_SIZE, 4), np.uint8)

        # 各档位笔画分别画到自己的透明层
        layers = {"green": None, "yellow": None, "red": None}
        cl_layers = {"green": None, "yellow": None, "red": None}
        per_stroke_polys = [sample_svg_strokes([s]) for s in strokes]
        for idx, polys in enumerate(per_stroke_polys):
            align = stroke_scores[idx] if stroke_scores and idx < len(stroke_scores) \
                else None
            name = _stroke_color_name(align)
            if name is None:
                for poly in _polys_scaled(polys, GRID_SIZE):
                    cv2.fillPoly(grid, [poly], _STROKE_LAYER_BGR["none"])
                continue
            layer = layers[name]
            if layer is None:
                layer = np.zeros((GRID_SIZE, GRID_SIZE, 4), np.uint8)
            bgr = _STROKE_LAYER_BGR[name]
            for poly in _polys_scaled(polys, GRID_SIZE):
                cv2.fillPoly(layer, [poly], (*bgr, 255))
            layers[name] = layer

        # 手写笔迹（黑）
        if ink is not None and cv2.countNonZero(ink):
            ink_layer[ink > 0] = (34, 34, 34, 255)

        # 标准笔画中线（红，带起点圆点）：分了档的跟笔画同层，便于一起筛选
        def draw_centerline(canvas, stroke):
            pts = np.array(stroke, np.int32).reshape(-1, 1, 2)
            cv2.polylines(canvas, [pts], False, (0, 0, 255, 255), 5, cv2.LINE_AA)
            cv2.circle(canvas, tuple(pts[0, 0]), 9, (0, 0, 255, 255), -1, cv2.LINE_AA)

        for idx, stroke in enumerate(medians):
            align = stroke_scores[idx] if stroke_scores and idx < len(stroke_scores) \
                else None
            name = _stroke_color_name(align)
            if name is None:
                draw_centerline(ink_layer, stroke)
                continue
            layer = cl_layers[name]
            if layer is None:
                layer = np.zeros((GRID_SIZE, GRID_SIZE, 4), np.uint8)
            draw_centerline(layer, stroke)
            cl_layers[name] = layer

        out = {"grid": _encode_rgba(grid)}
        for name, layer in layers.items():
            out[name] = _encode_rgba(layer) if layer is not None else None
        for name, layer in cl_layers.items():
            out[name + "_cl"] = _encode_rgba(layer) if layer is not None else None

        # 标准字形层：整字深灰（像 hanzi-writer preview 的 #333），
        # 供前端「只看标准」单独查看这个字该长什么样
        if strokes:
            std_layer = np.zeros((GRID_SIZE, GRID_SIZE, 4), np.uint8)
            for polys in per_stroke_polys:
                for poly in _polys_scaled(polys, GRID_SIZE):
                    cv2.fillPoly(std_layer, [poly], (51, 51, 51, 255))
            out["std"] = _encode_rgba(std_layer)
        else:
            out["std"] = None
        out["ink"] = _encode_rgba(ink_layer)
        return out
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
