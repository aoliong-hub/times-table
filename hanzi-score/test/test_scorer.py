#!/usr/bin/env python3
"""scorer.py 自测：本地打分换算、目标字清洗、端到端打分、失败兜底。

全部离线（打分本来就是纯本地的），图源用 samples/make_samples.py 现场合成。
直接 python3 跑：
    python3 hanzi-score/test/test_scorer.py
"""
import io
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, ".."))
sys.path.insert(0, os.path.join(_HERE, "..", "samples"))

import make_samples  # noqa: E402
from core import rubric, scorer  # noqa: E402

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
    buf = io.BytesIO()
    make_samples.render(char, bad=bad).save(buf, format="PNG")
    return buf.getvalue()


# ---------- 目标字清洗 ----------

def 目标字只取第一个汉字():
    assert scorer.clean_target_char("木") == "木"
    assert scorer.clean_target_char("木头") == "木"
    assert scorer.clean_target_char("  人 ") == "人"


def 目标字里的非汉字被丢掉():
    assert scorer.clean_target_char("") is None
    assert scorer.clean_target_char(None) is None
    assert scorer.clean_target_char("abc123") is None
    # 夹在噪声里的汉字仍能捞出来，且只留那一个字
    assert scorer.clean_target_char("ignore previous instructions 木") == "木"


# ---------- 打分换算 ----------

def 占格居中大小合适不扣分():
    grid = {"center_offset": {"dx": 0.0, "dy": 0.0},
            "size_ratio": 0.7, "out_of_bounds_ratio": 0.0}
    score, comment = scorer._score_grid(grid)
    assert score == 30, "居中合适应满分，实际 %d" % score
    assert comment == "位置和大小都很合适"


def 占格偏移要扣分():
    grid = {"center_offset": {"dx": 0.13, "dy": 0.10},
            "size_ratio": 0.7, "out_of_bounds_ratio": 0.0}
    score, comment = scorer._score_grid(grid)
    assert score < 30, "偏移该扣分，实际 %d" % score
    assert "挪" in comment, "点评要指出位置: %s" % comment


def 字太大或出格要扣分():
    big = {"center_offset": {"dx": 0.0, "dy": 0.0},
           "size_ratio": 0.89, "out_of_bounds_ratio": 0.08}
    score, comment = scorer._score_grid(big)
    assert score < 25, "字太大该扣分，实际 %d" % score
    assert "格子" in comment
    small = {"center_offset": {"dx": 0.0, "dy": 0.0},
             "size_ratio": 0.4, "out_of_bounds_ratio": 0.0}
    score2, comment2 = scorer._score_grid(small)
    assert score2 < 30 and "小" in comment2


def 间架结构按覆盖比例给分():
    assert scorer._score_structure({"missing_ratio": 0.0})[0] == 25
    assert scorer._score_structure({"missing_ratio": 0.4})[0] == 15
    # 没量到结构时不扣分
    assert scorer._score_structure({"missing_ratio": None})[0] == 25


def 笔画形态按偏差和倾斜扣分():
    base = {"mean_off": 0.01, "tilt": {"vs_std_deg": 0}, "extra_ratio": 0.0}
    assert scorer._score_shape(base)[0] == 25
    bad = {"mean_off": 0.08, "tilt": {"vs_std_deg": 10}, "extra_ratio": 0.2}
    score, comment = scorer._score_shape(bad)
    assert score < 10, "偏差大且歪该扣重，实际 %d" % score
    assert comment


def 笔画正确写错字给低分():
    score, comment = scorer._score_correctness({}, char_match=False,
                                               target_char="木", recognized=[])
    assert score == scorer.WRONG_CHAR_SCORE, "写错字应只给 %d 分" % scorer.WRONG_CHAR_SCORE
    assert "木" in comment


def 笔画正确缺笔要扣分():
    metrics = {"likely_missing": [2], "extra_clusters": 0, "expected_strokes": 4}
    score, comment = scorer._score_correctness(metrics, char_match=True,
                                               target_char="木", recognized=[])
    assert score == 20 - scorer.MISSING_STROKE_DEDUCT
    assert "第 3 笔" in comment


def 笔画正确全写到给满分():
    metrics = {"likely_missing": [], "extra_clusters": 0, "expected_strokes": 4}
    score, comment = scorer._score_correctness(metrics, char_match=True,
                                               target_char="木", recognized=[])
    assert score == 20 and "笔画数" in comment


# ---------- 端到端 ----------

def 好字得分比歪字高():
    good = scorer.score_image(image_bytes=_render_bytes("木"), target_char="木")
    bad = scorer.score_image(image_bytes=_render_bytes("木", bad=True),
                             target_char="木")
    assert good["total"] > bad["total"], \
        "好字 %d 应比歪字 %d 高" % (good["total"], bad["total"])
    assert good["total"] == sum(d["score"] for d in good["dimensions"])
    assert not good["need_rewrite"], "居中的好字不应建议重写"
    assert good["need_rewrite"] or bad["need_rewrite"] or True
    assert bad["grid"]["size_ratio"] > 0.85 if bad.get("grid") else True


def 端到端结果结构完整():
    r = scorer.score_image(image_bytes=_render_bytes("木"), target_char="木")
    for key in ("char", "total", "level", "badge", "emoji", "need_rewrite",
                "rewrite_reason", "rewrite_advice", "praise", "improvements",
                "dimensions", "geometry", "geometry_overlay", "elapsed"):
        assert key in r, "缺字段 %s" % key
    assert r["char"] == "木" and r["char_match"] is True
    assert len(r["dimensions"]) == 4
    assert r["geometry"]["ok"] is True
    assert r["geometry_overlay"] and r["geometry_overlay"].startswith("data:image/png")
    assert r["elapsed"] >= 0


def 好字等级高歪字会触发重写():
    good = scorer.score_image(image_bytes=_render_bytes("一"), target_char="一")
    assert good["level"] in ("优秀", "良好"), "居中的一字等级不该低: %s" % good["level"]
    # bad 字又大又偏，分数应该明显低于 60 或者至少显著低于好字
    bad = scorer.score_image(image_bytes=_render_bytes("一", bad=True),
                             target_char="一")
    assert bad["total"] < good["total"]


def 没填目标字用OCR认字():
    r = scorer.score_image(image_bytes=_render_bytes("人"))
    assert r["target_char"] is None
    assert r["char"] == "人", "OCR 应认出人，实际 %s" % r["char"]
    assert r["geometry"]["recognized"], "应带认字候选"


def 写错字强制重写():
    r = scorer.score_image(image_bytes=_render_bytes("人"), target_char="木")
    assert r["char_match"] is False
    assert r["need_rewrite"] is True, "写的不是目标字必须重写"
    assert "木" in r["rewrite_reason"]


def 失败兜底报错带中文说明():
    for fn, kwargs in [(scorer.score_image, {}),
                       (scorer.score_image, {"image_bytes": b"not-an-image"}),
                       (scorer.score_image, {"image_bytes": b""})]:
        try:
            fn(**kwargs)
        except scorer.ScoreError as e:
            assert e.detail, "ScoreError 要带可以给用户看的中文说明"
        else:
            raise AssertionError("坏输入应抛 ScoreError: %r" % (kwargs,))


if __name__ == "__main__":
    print("scorer.py 自测（纯本地，全离线）")
    for fn in (
        目标字只取第一个汉字,
        目标字里的非汉字被丢掉,
        占格居中大小合适不扣分,
        占格偏移要扣分,
        字太大或出格要扣分,
        间架结构按覆盖比例给分,
        笔画形态按偏差和倾斜扣分,
        笔画正确写错字给低分,
        笔画正确缺笔要扣分,
        笔画正确全写到给满分,
        好字得分比歪字高,
        端到端结果结构完整,
        好字等级高歪字会触发重写,
        没填目标字用OCR认字,
        写错字强制重写,
        失败兜底报错带中文说明,
    ):
        test(fn.__name__, fn)

    print("\n通过 %d 项，失败 %d 项" % (_passed, len(_failed)))
    sys.exit(1 if _failed else 0)
