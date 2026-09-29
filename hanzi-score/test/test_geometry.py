#!/usr/bin/env python3
"""geometry.py 自测：标准字加载、田字格检测、笔迹提取、比对指标、本地认字。

全部离线：图源用 samples/make_samples.py 现场合成（不读盘、不发网络请求）。
直接 python3 跑：
    python3 hanzi-score/test/test_geometry.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))
sys.path.insert(0, os.path.join(_HERE, "..", "samples"))

import numpy as np  # noqa: E402
import cv2  # noqa: E402
import make_samples  # noqa: E402
from core import geometry  # noqa: E402

_passed = 0
_failed = []


def test(name, fn):
    global _passed
    try:
        fn()
        _passed += 1
        print(f"  ✓ {name}")
    except AssertionError as e:
        _failed.append((name, str(e)))
        print(f"  ✗ {name}: {e}")


def _render_bytes(char, bad=False):
    """make_samples 现场画一张图 → PNG bytes（和上传链路同一口径）。"""
    import io
    buf = io.BytesIO()
    make_samples.render(char, bad=bad).save(buf, format="PNG")
    return buf.getvalue()


# ---------- 标准字 ----------

def 标准字加载能拿到笔画和笔数():
    std = geometry.load_standard("木")
    assert std is not None, "木 的标准字数据加载失败"
    assert std["stroke_count"] == 4, "木 应该是 4 笔，实际 %s" % std["stroke_count"]
    assert len(std["medians"]) == 4
    assert geometry.load_standard("丆勽") is None      # 不是单个汉字
    assert geometry.load_standard(None) is None


def 标准字mask尺寸和密度合理():
    std = geometry.load_standard("木")
    mask = geometry.render_standard_mask(std["medians"])
    assert mask.shape == (1024, 1024)
    ratio = cv2.countNonZero(mask) / mask.size
    assert 0.01 < ratio < 0.20, "mask 密度 %.3f 不在合理区间" % ratio
    # 数据集是 y 向上的，翻转后笔画该朝下：字底应延伸到接近画布底缘
    pts = cv2.findNonZero(mask)[:, 0]
    ys = pts[:, 1]
    assert ys.max() > 850, "翻转后字的底部应在 850 以下，实际 %d" % ys.max()


def 小尺寸渲染坐标要缩放():
    """medians 是 1024 坐标系，画到 256 时必须缩放，否则整段被裁掉。"""
    std = geometry.load_standard("一")
    small = geometry.render_standard_mask(std["medians"], size=256, width=10)
    assert cv2.countNonZero(small) > 100, "256 渲染几乎全空，说明坐标没缩放"


# ---------- 照片管线 ----------

def 合成图能找到田字格外框():
    img = geometry._load_source(_render_bytes("木"))
    cell = geometry.find_cell(img)
    assert cell is not None, "合成田字格图上找不到外框"
    quad = cell["quad"]
    expect = np.array([[24, 24], [456, 24], [456, 456], [24, 456]], np.float32)
    err = np.abs(quad - expect).max()
    assert err < 8, "角点误差 %.1fpx 过大" % err
    # 纯色图上找不到框
    blank = np.full((480, 480, 3), 250, np.uint8)
    assert geometry.find_cell(blank) is None


def 墨迹提取不含红格线():
    img = geometry._load_source(_render_bytes("木"))
    warped = geometry.warp_to_cell(img, geometry.find_cell(img)["quad"])
    ink = geometry.extract_ink(warped)
    ratio = cv2.countNonZero(ink) / ink.size
    assert 0.005 < ratio < 0.25, "墨迹占比 %.3f 异常" % ratio
    # 左边框中点在格线上，不应被当成墨迹
    assert ink[512, 57] == 0, "红格线被当成了墨迹（(512,57) 处应为 0）"
    # 竖中线（虚线）上取没被字盖住的点，也不应是墨迹
    assert ink[60, 512] == 0, "田字格虚线中线被当成了墨迹"


# ---------- 比对指标 ----------

def _metrics(char, bad=False):
    r = geometry.extract(_render_bytes(char, bad=bad), char)
    assert r["ok"], "extract 失败: %s" % r
    return r["metrics"]


def 好字比歪字贴合():
    good, bad = _metrics("木"), _metrics("木", bad=True)
    assert good["mean_off"] < bad["mean_off"], \
        "好字 mean_off %.4f 应小于歪字 %.4f" % (good["mean_off"], bad["mean_off"])
    assert 0.55 < good["grid"]["size_ratio"] < 0.85, \
        "好字占格 %.2f 应在六成到八成半之间" % good["grid"]["size_ratio"]
    assert bad["grid"]["size_ratio"] > 0.85, "歪字应明显偏大"
    go = good["grid"]["center_offset"]
    bo = bad["grid"]["center_offset"]
    assert abs(bo["dx"]) > abs(go["dx"]) and abs(bo["dy"]) > abs(go["dy"]), \
        "歪字的中心偏移应比好字大"


def 好字四笔全部写到():
    m = _metrics("木")
    assert m["strokes"] and len(m["strokes"]) == 4
    assert m["likely_missing"] == [], "好字不应报疑似缺笔: %s" % m["likely_missing"]
    assert m["missing_ratio"] < 0.2, "好字 missing_ratio %.3f 过高" % m["missing_ratio"]
    assert m["ink"]["stroke_width_px"], "实测笔画宽没量出来"


def 缺一笔能报疑似缺笔():
    """只画木的前三笔（少捺），比对应报第 4 笔疑似缺失。"""
    import io
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (make_samples.SIZE, make_samples.SIZE), make_samples.BG)
    draw = ImageDraw.Draw(img)
    make_samples.draw_grid(draw)
    left, top, right, bottom = make_samples.MARGIN, make_samples.MARGIN, \
        make_samples.SIZE - make_samples.MARGIN, make_samples.SIZE - make_samples.MARGIN
    cell = right - left
    for stroke in make_samples.strokes_for("木")[:3]:
        pts = [(left + rx * cell, top + ry * cell) for rx, ry in stroke]
        draw.line(pts, fill=make_samples.INK, width=9, joint="curve")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    r = geometry.extract(buf.getvalue(), "木")
    assert r["ok"], "extract 失败: %s" % r
    assert 3 in r["metrics"]["likely_missing"], \
        "缺捺应报第 4 笔（下标 3）疑似缺失，实际 %s" % r["metrics"]["likely_missing"]


def 失败兜底不抛异常():
    for blob in [b"", b"not an image",
                 np.full((8, 8, 3), 255, np.uint8).tobytes(),
                 np.zeros((480, 480, 3), np.uint8).tobytes()]:
        r = geometry.extract(blob, "木")
        assert r["ok"] is False, "坏输入应返回 ok=False"
        assert r.get("reason"), "失败要带 reason"
    # 图片没问题但不带目标字时也能出占格指标
    r = geometry.extract(_render_bytes("木"), None)
    assert r["ok"] and r["metrics"]["grid"]["size_ratio"] > 0.5


# ---------- 认字 ----------

def 本地认字认对四个合成字():
    for char in ["一", "十", "人", "木"]:
        r = geometry.extract(_render_bytes(char))
        rec = r.get("recognized") or []
        chars = [x["char"] for x in rec]
        assert char in chars, "认字结果 %s 里没有「%s」" % (chars, char)
        assert chars[0] == char, "「%s」应排第一，实际 %s" % (char, chars[0])


def 认字结果带置信度():
    r = geometry.extract(_render_bytes("木"))
    rec = (r.get("recognized") or [{}])[0]
    assert 0 <= rec.get("score", 0) <= 1, "置信度应在 0~1"
    assert rec.get("source") in ("ocr", "template")


# ---------- 输出 ----------

def summarize输出中文行():
    r = geometry.extract(_render_bytes("木", bad=True), "木")
    lines = r["lines"]
    assert lines and all(isinstance(x, str) for x in lines)
    assert any("占格" in x for x in lines), "应包含占格行: %s" % lines
    # 认字行：无目标字时应有
    r2 = geometry.extract(_render_bytes("木"))
    assert any("认字" in x for x in (r2["lines"] or [])), "无目标字应报认字行"


def 叠加图分层能生成PNG():
    r = geometry.extract(_render_bytes("木"), "木")
    std = geometry.load_standard("木")
    # 给每笔明确的对齐率：green 层和 red 层都该有内容
    pngs = geometry.build_overlay_pngs(r["warped"], std, r["ink"],
                                       stroke_scores=[1.0, 0.0, 1.0, 1.0])
    assert pngs and {"grid", "green", "yellow", "red", "ink"} <= set(pngs), \
        "分层不对: %s" % sorted(pngs)
    for name in ("grid", "green", "red", "ink"):
        assert pngs[name] and pngs[name][:4] == b"\x89PNG", "%s 层应是 PNG" % name
    assert pngs["yellow"] is None, "没有黄色档的笔时该给 None"
    # 中线跟笔画同档分层，便于前端一起显隐
    for name in ("green", "red"):
        assert pngs[name + "_cl"] and pngs[name + "_cl"][:4] == b"\x89PNG", \
            "%s 的中线层应是 PNG" % name
    assert pngs["yellow_cl"] is None, "没有黄色档笔画时中线层也该是 None"
    # 标准字形层（整字深灰，供「只看标准」）
    assert pngs["std"] and pngs["std"][:4] == b"\x89PNG", "标准字形层应是 PNG"
    # 绿层里有绿色像素（带 alpha），红层里有红色像素
    green = cv2.imdecode(np.frombuffer(pngs["green"], np.uint8), cv2.IMREAD_UNCHANGED)
    red = cv2.imdecode(np.frombuffer(pngs["red"], np.uint8), cv2.IMREAD_UNCHANGED)
    assert green.shape[2] == 4, "颜色层应是带透明通道的 RGBA"
    assert int(np.count_nonzero((green[..., 2] == 170) & (green[..., 3] == 255))) > 500
    assert int(np.count_nonzero((red[..., 2] == 255) & (red[..., 0] == 140) & (red[..., 3] == 255))) > 500
    # 没有标准字时也不炸
    assert geometry.build_overlay_pngs(r["warped"], None, None) is not None


def 零网络断言():
    with open(os.path.join(os.path.dirname(_HERE), "core", "geometry.py"),
              encoding="utf-8") as fh:
        src = fh.read()
    for banned in ("import requests", "import urllib", "import socket",
                   "import httpx", "urllib.request"):
        assert banned not in src, "geometry.py 不应联网（发现 %s）" % banned


import numpy as np  # noqa: E402  (放后面也行，测试函数运行时已可用)


if __name__ == "__main__":
    print("geometry 自测（全部离线）")
    test("标准字加载能拿到笔画和笔数", 标准字加载能拿到笔画和笔数)
    test("标准字mask尺寸和密度合理", 标准字mask尺寸和密度合理)
    test("小尺寸渲染坐标要缩放", 小尺寸渲染坐标要缩放)
    test("合成图能找到田字格外框", 合成图能找到田字格外框)
    test("墨迹提取不含红格线", 墨迹提取不含红格线)
    test("好字比歪字贴合", 好字比歪字贴合)
    test("好字四笔全部写到", 好字四笔全部写到)
    test("缺一笔能报疑似缺笔", 缺一笔能报疑似缺笔)
    test("失败兜底不抛异常", 失败兜底不抛异常)
    test("本地认字认对四个合成字", 本地认字认对四个合成字)
    test("认字结果带置信度", 认字结果带置信度)
    test("summarize输出中文行", summarize输出中文行)
    test("叠加图分层能生成PNG", 叠加图分层能生成PNG)
    test("零网络断言", 零网络断言)

    print("\n通过 %d 项，失败 %d 项" % (_passed, len(_failed)))
    sys.exit(1 if _failed else 0)
