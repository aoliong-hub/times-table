#!/usr/bin/env python3
"""rubric.py 自测：等级边界、重写判定、维度定义、分数夹紧。

零依赖，直接 python3 跑：
    python3 hanzi-score/test/test_rubric.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from core import rubric  # noqa: E402

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


# ---------- 维度定义 ----------

def 四个维度满分加起来是一百():
    assert rubric.FULL_MARKS == 100, f"实际 {rubric.FULL_MARKS}"
    assert len(rubric.DIMENSIONS) == 4


def 维度字段齐全且key不重复():
    keys = [d["key"] for d in rubric.DIMENSIONS]
    assert len(keys) == len(set(keys)), f"key 重复: {keys}"
    for d in rubric.DIMENSIONS:
        for field in ("key", "name", "full", "checks"):
            assert d.get(field), f"{d.get('key')} 缺 {field}"
        assert isinstance(d["checks"], list) and d["checks"], \
            f"{d['key']} 的 checks 应该是非空列表"


def 按key能查到维度定义():
    assert rubric.get_dimension("grid")["name"] == "占格位置"
    assert rubric.get_dimension("correctness")["full"] == 20
    assert rubric.get_dimension("不存在的key") is None
    assert set(rubric.dimension_map()) == {
        "grid", "structure", "stroke_shape", "correctness"}


# ---------- 等级边界 ----------

def 等级边界九十为优秀():
    assert rubric.level_of(100)["name"] == "优秀"
    assert rubric.level_of(90)["name"] == "优秀"
    assert rubric.level_of(89)["name"] == "良好"


def 等级边界七十五为良好():
    assert rubric.level_of(75)["name"] == "良好"
    assert rubric.level_of(74)["name"] == "合格"


def 等级边界六十为合格():
    assert rubric.level_of(60)["name"] == "合格"
    assert rubric.level_of(59)["name"] == "需重写"
    assert rubric.level_of(0)["name"] == "需重写"


def 每个等级都有徽章和表情():
    for level in rubric.LEVELS:
        assert level["badge"], f"{level['name']} 缺 badge 文案"
        assert level["emoji"], f"{level['name']} 缺 emoji"


# ---------- 重写判定 ----------

def 低于六十分需要重写():
    g = rubric.grade(59, {"correctness": 20})
    assert g["need_rewrite"] is True
    assert g["level"] == "需重写"
    assert g["rewrite_reason"], "需重写必须给出理由"


def 刚好六十分不用重写():
    g = rubric.grade(60, {"correctness": 20})
    assert g["need_rewrite"] is False, "60 分是合格线，不该判重写"
    assert g["rewrite_reason"] == ""


def 写错字高分也要重写():
    # correctness 满分 20，低于 10 视为写错字/明显缺笔画 -> 强制重写
    g = rubric.grade(
        95, {"grid": 30, "structure": 25, "stroke_shape": 25, "correctness": 9})
    assert g["need_rewrite"] is True, "笔画正确分过低必须重写，不管总分多高"
    assert "字" in g["rewrite_reason"], f"理由要说清是字写错了: {g['rewrite_reason']}"


def 笔画正确刚好十分不强制重写():
    g = rubric.grade(
        90, {"grid": 30, "structure": 25, "stroke_shape": 25, "correctness": 10})
    assert g["need_rewrite"] is False
    assert g["level"] == "优秀"


def 缺少笔画正确维度时不误判():
    # 模型没给 correctness 时不应该当成 0 分而强制重写
    g = rubric.grade(80, {})
    assert g["need_rewrite"] is False
    assert g["level"] == "良好"


# ---------- 分数夹紧 ----------

def 分数超出满分被夹到满分():
    assert rubric.clamp_score("grid", 35) == 30
    assert rubric.clamp_score("correctness", 100) == 20


def 负分和乱值一律当零分():
    assert rubric.clamp_score("grid", -5) == 0
    assert rubric.clamp_score("grid", None) == 0
    assert rubric.clamp_score("grid", "写得不错") == 0
    assert rubric.clamp_score("不存在的key", 20) == 0


def 小数分数四舍五入取整():
    assert rubric.clamp_score("grid", 24.6) == 25
    assert rubric.clamp_score("grid", "18") == 18


# ---------- 喂给模型的要点文本 ----------

def 书写要点文本非空且含田字格要求():
    text = rubric.writing_guide_text()
    assert len(text) > 100, "书写要点太短，prompt 会缺少判据"
    assert "田字格" in text
    for d in rubric.DIMENSIONS:
        assert d["name"] in text, f"要点里缺维度 {d['name']}"
        assert str(d["full"]) in text, f"要点里缺 {d['name']} 的满分"


def 阈值常量符合约定():
    assert rubric.PASS_SCORE == 60
    assert rubric.CORRECTNESS_MIN == 10
    assert rubric.MAX_IMPROVEMENTS == 3
    assert rubric.DEFAULT_PRAISE


if __name__ == "__main__":
    print("rubric.py 自测")
    for fn in (
        四个维度满分加起来是一百,
        维度字段齐全且key不重复,
        按key能查到维度定义,
        等级边界九十为优秀,
        等级边界七十五为良好,
        等级边界六十为合格,
        每个等级都有徽章和表情,
        低于六十分需要重写,
        刚好六十分不用重写,
        写错字高分也要重写,
        笔画正确刚好十分不强制重写,
        缺少笔画正确维度时不误判,
        分数超出满分被夹到满分,
        负分和乱值一律当零分,
        小数分数四舍五入取整,
        书写要点文本非空且含田字格要求,
        阈值常量符合约定,
    ):
        test(fn.__name__, fn)

    print(f"\n通过 {_passed} 项，失败 {len(_failed)} 项")
    sys.exit(1 if _failed else 0)
