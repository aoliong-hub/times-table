# -*- coding: utf-8 -*-
"""汉字书写打分核心：构造提示词 → 调多模态 LLM → 归一化成前端要的 JSON。

不 import fastapi、不碰 HTTP，第二阶段换外壳时直接调 score_image()。

离线约定：没有 API key 的环境下用 mock=True，整条链路照走但不联网，
返回构造好的假评分（按图片内容取固定一种，同一张图结果稳定）。
"""

import hashlib
import os
import re
import sys
import time

_HERE = os.path.dirname(os.path.abspath(__file__))
# core/ -> hanzi-score/ -> times-table/ -> code/，llm_client 就在 code/ 下
_CODE_ROOT = os.path.abspath(os.path.join(_HERE, "..", "..", ".."))
if _CODE_ROOT not in sys.path:
    sys.path.insert(0, _CODE_ROOT)

try:
    from . import rubric
except ImportError:  # 直接 python core/scorer.py 跑时
    import rubric

DEFAULT_MODEL = os.environ.get("HANZI_MODEL", "gemini-3.5-flash")
PROJECT = "hanzi_score"          # 进 llm_client 用量日志的项目名
IMAGE_MAX_SIZE = 1280            # 送模型前的长边上限，够看清笔画又不至于太贵

_CJK_RE = re.compile("[一-鿿]")


class ScoreError(Exception):
    """打分失败。detail 是可以直接给用户看的中文说明。"""

    def __init__(self, detail, *, cause=None, content=None):
        super().__init__(detail)
        self.detail = detail
        self.cause = cause
        self.content = content       # 模型原始输出，便于排查


def clean_target_char(text):
    """从用户输入里取第一个汉字，取不到返回 None。

    目标字会进提示词，所以只放行汉字，不让任意文本拼进去。
    """
    if not text:
        return None
    match = _CJK_RE.search(str(text))
    return match.group(0) if match else None


# ---------------------------------------------------------------- 提示词

_JSON_SCHEMA = """{
  "char": "你认出的字",
  "dimensions": {
    "grid":         {"score": 24, "comment": "一句话点评"},
    "structure":    {"score": 20, "comment": "一句话点评"},
    "stroke_shape": {"score": 18, "comment": "一句话点评"},
    "correctness":  {"score": 20, "comment": "一句话点评"}
  },
  "praise": "一句具体的表扬",
  "improvements": ["改进点一", "改进点二"],
  "rewrite_advice": null
}"""


def build_system_prompt():
    """系统提示词：老师人设 + 汉字书写要点 + 打分尺度 + 输出格式。"""
    return """你是一位小学一年级的语文写字老师，正在批改学生的田字格写字作业。
你说话像老师对着孩子说话：先看见好的地方，再说怎么改，一句话说清一件事，不用专业术语。

【汉字书写要点】按下面四项分别打分，每项独立给分：
%s

【打分尺度】用一年级的标准，不要拿书法家的标准苛求孩子：
- 笔画到位、占格端正 —— 该项给接近满分
- 看得出在认真写，只是某几笔歪了或偏了 —— 该项扣掉五分之一到三分之一
- 明显出格、结构松散、笔画歪斜严重 —— 该项扣掉一半以上
- 字写错了、缺笔画、认不出是哪个字 —— 「笔画正确」项给 0 到 5 分
- 只要是孩子自己动手写的，就不要给毫无肯定的评价；分数低也要留一句鼓励

【输出】只输出一个 JSON 对象，不要解释文字，不要 markdown 代码块：
%s

字段要求：
- char：你从图里认出来的那个字；实在认不出就写 "?"
- 每项的 comment：一句话，20 字以内，说清这一项好在哪或差在哪
- praise：一句具体的表扬，指出写得最好的那一笔或那一处，不要空泛地说「很好」
- improvements：1 到 %d 条改进点，每条一句话，用一年级孩子听得懂的说法，
  可以打比方（例如「横要写平一点，像小桌子的桌面」）。写得很好时也至少给 1 条
- rewrite_advice：如果这个字需要重写，写一句鼓励加上这一遍重点改哪里；不需要重写就填 null
- 不要自己算总分，总分由程序累加各项得分""" % (
        rubric.writing_guide_text(),
        _JSON_SCHEMA,
        rubric.MAX_IMPROVEMENTS,
    )


def build_user_text(target_char=None):
    """用户侧指令：说明图是什么、要不要对照目标字。"""
    head = "这是学生在田字格里写的一个字，请批改。"
    if target_char:
        return (
            head
            + "\n这一格要写的字是「%s」。请按这个字的写法批改：" % target_char
            + "如果图里写的不是这个字，「笔画正确」项给 0 到 5 分，并在 comment 里说明写成了什么。"
        )
    return head + "\n请先认出图里写的是哪个字，再按那个字的写法批改。"


def build_messages(image_data_uri, target_char=None):
    """拼成 OpenAI 格式的 messages（图 + 文）。"""
    return [
        {"role": "system", "content": build_system_prompt()},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": image_data_uri}},
                {"type": "text", "text": build_user_text(target_char)},
            ],
        },
    ]


# ---------------------------------------------------------------- 归一化

def _one_line(text, limit=60):
    """压成一行、去掉首尾空白、截断。非字符串一律当空。"""
    if not isinstance(text, str):
        return ""
    cleaned = " ".join(text.split()).strip()
    return cleaned[:limit]


def normalize(raw, target_char=None):
    """把模型原始输出整理成前端要的结构，顺便把不可信的地方兜住。

    做四件事：分数夹到 [0, full]、总分按各项累加（不采信模型自己算的）、
    改进点截到 MAX_IMPROVEMENTS 条、按 rubric 判等级与是否重写。
    """
    raw = raw if isinstance(raw, dict) else {}
    dims_raw = raw.get("dimensions")
    dims_raw = dims_raw if isinstance(dims_raw, dict) else {}

    dimensions = []
    scores = {}
    for dim in rubric.DIMENSIONS:
        item = dims_raw.get(dim["key"])
        if not isinstance(item, dict):
            item = {"score": item}      # 模型有时直接给个数字而不是对象
        score = rubric.clamp_score(dim["key"], item.get("score"))
        scores[dim["key"]] = score
        dimensions.append({
            "key": dim["key"],
            "name": dim["name"],
            "score": score,
            "full": dim["full"],
            "comment": _one_line(item.get("comment")),
        })

    total = sum(scores.values())
    verdict = rubric.grade(total, scores)

    char = _one_line(raw.get("char"), limit=4) or "?"
    char_match = None
    if target_char:
        char_match = (char == target_char)
        # 认出来的字和要写的字不是一个 —— 写错字了，必须重写
        if char_match is False and char != "?":
            verdict["need_rewrite"] = True
            verdict["rewrite_reason"] = "写的不是「%s」" % target_char

    improvements = []
    for item in (raw.get("improvements") or []):
        line = _one_line(item, limit=80)
        if line:
            improvements.append(line)
    improvements = improvements[:rubric.MAX_IMPROVEMENTS]

    advice = _one_line(raw.get("rewrite_advice"), limit=80)
    if verdict["need_rewrite"] and not advice:
        advice = "别灰心，擦掉再写一遍，这次先把字写在格子正中间。"
    if not verdict["need_rewrite"]:
        advice = None

    return {
        "char": char,
        "target_char": target_char,
        "char_match": char_match,
        "total": total,
        "full_marks": rubric.FULL_MARKS,
        "level": verdict["level"],
        "badge": verdict["badge"],
        "emoji": verdict["emoji"],
        "need_rewrite": verdict["need_rewrite"],
        "rewrite_reason": verdict["rewrite_reason"],
        "rewrite_advice": advice,
        "praise": _one_line(raw.get("praise"), limit=80) or rubric.DEFAULT_PRAISE,
        "improvements": improvements,
        "dimensions": dimensions,
    }


# ---------------------------------------------------------------- 打分入口

def score_image(*, image_bytes=None, image_path=None, target_char=None,
                model=None, api_key=None, mock=False, mock_variant=None,
                max_size=IMAGE_MAX_SIZE):
    """给一张田字格练字图打分。

    Args:
        image_bytes: 图片字节（上传场景，不落盘）。
        image_path:  图片路径（CLI / 批量场景）。二者给一个即可。
        target_char: 这一格应该写的字，可选。
        model:       模型名，默认 DEFAULT_MODEL。
        api_key:     覆盖环境变量里的 key。
        mock:        True 则不联网，返回构造好的假评分。
        mock_variant: 指定 mock 的形态（excellent/good/pass/rewrite），只在 mock 下有效。

    Returns:
        normalize() 的结果，外加 model / elapsed / usage / mock 四个字段。

    Raises:
        ScoreError: 图片不可读、模型调用失败、或输出解析不出 JSON。
    """
    source = image_bytes if image_bytes is not None else image_path
    if source is None:
        raise ScoreError("没有拿到图片")

    target_char = clean_target_char(target_char)
    started = time.time()

    if mock:
        result = mock_result(target_char=target_char, seed=source,
                             variant=mock_variant)
        result["elapsed"] = round(time.time() - started, 3)
        return result

    # 真实调用：延迟 import，让 mock 模式在没装 openai 的机器上也能跑
    from llm_client import LLMError, call_llm, extract_json, image_to_base64_url

    try:
        data_uri = image_to_base64_url(source, max_size=max_size)
    except Exception as exc:
        raise ScoreError("图片打不开，换一张试试", cause=exc)

    messages = build_messages(data_uri, target_char)
    try:
        res = call_llm(
            messages=messages,
            model=model or DEFAULT_MODEL,
            project=PROJECT,
            temperature=0.2,            # 打分求可复现
            max_tokens=2048,
            retry_on_parse=True,        # 提示词是固定的，重试划算
            api_key=api_key or None,
            extra={"target_char": target_char or ""},
        )
    except LLMError as exc:
        raise ScoreError("打分服务暂时用不了，过一会儿再试", cause=exc,
                         content=getattr(exc, "content", None))
    except Exception as exc:           # 缺 key、网络不通等
        raise ScoreError("调用打分模型失败：%s" % exc, cause=exc)

    parsed = res.parsed or extract_json(res.content)
    if not isinstance(parsed, dict):
        raise ScoreError("模型没有按格式回答，请再试一次", content=res.content)

    result = normalize(parsed, target_char)
    result["model"] = res.model
    result["usage"] = res.usage
    result["retries"] = res.retries
    result["mock"] = False
    result["elapsed"] = round(time.time() - started, 3)
    return result


# ---------------------------------------------------------------- mock

# 四种形态，覆盖满分附近到需重写。分数写的是各项原始分，总分由 normalize 累加。
MOCK_VARIANTS = {
    "excellent": {
        "raw": {
            "dimensions": {
                "grid": {"score": 28, "comment": "端端正正写在格子中间"},
                "structure": {"score": 23, "comment": "上下比例很匀"},
                "stroke_shape": {"score": 23, "comment": "横平竖直，收笔干净"},
                "correctness": {"score": 20, "comment": "笔画数正确"},
            },
            "praise": "长横压住了横中线，一看就很稳！",
            "improvements": ["撇还可以再伸展一点，像小树的枝丫。"],
            "rewrite_advice": None,
        },
    },
    "good": {
        "raw": {
            "dimensions": {
                "grid": {"score": 25, "comment": "位置不错，稍微偏上一点"},
                "structure": {"score": 20, "comment": "间距基本匀称"},
                "stroke_shape": {"score": 19, "comment": "竖有一点点斜"},
                "correctness": {"score": 20, "comment": "笔画数正确"},
            },
            "praise": "横写得又平又稳，像小桌子的桌面！",
            "improvements": [
                "整个字往下挪一点，让上下留白一样多。",
                "竖要立直，像旗杆一样。",
            ],
            "rewrite_advice": None,
        },
    },
    "pass": {
        "raw": {
            "dimensions": {
                "grid": {"score": 21, "comment": "字偏左了，右边空出一块"},
                "structure": {"score": 16, "comment": "下半部分挤在一起"},
                "stroke_shape": {"score": 14, "comment": "两笔横都往下弯"},
                "correctness": {"score": 20, "comment": "笔画数正确"},
            },
            "praise": "笔画一笔都没少，认得出是这个字，很认真！",
            "improvements": [
                "把字往右挪一点，写到竖中线上。",
                "横要写平，别让它中间往下塌。",
                "下面两笔分开一点，别挤成一团。",
            ],
            "rewrite_advice": None,
        },
    },
    "rewrite": {
        "raw": {
            "dimensions": {
                "grid": {"score": 12, "comment": "字太大，右边顶出了格子"},
                "structure": {"score": 11, "comment": "重心歪向左边"},
                "stroke_shape": {"score": 9, "comment": "竖画弯得比较明显"},
                "correctness": {"score": 14, "comment": "有一笔写得像另一种笔画"},
            },
            "praise": "敢下笔写这么大的字，很有勇气！",
            "improvements": [
                "字写小一点，四周都留一圈空白。",
                "先找到格子正中间，再从那里起笔。",
                "竖要一笔直下来，中途别拐弯。",
            ],
            "rewrite_advice": "别灰心，擦掉再写一遍，这次把字缩小一点、写在格子正中间。",
        },
    },
}

_MOCK_ORDER = ["excellent", "good", "pass", "rewrite"]


def mock_result(target_char=None, seed=None, variant=None):
    """不联网的假评分，用来调试页面和接口。

    variant 显式指定形态（见 MOCK_VARIANTS）；不指定就按 seed（图片字节或路径）
    取一个固定形态 —— 同一张图每次都得到同样的分，换图才换分。
    """
    if variant not in MOCK_VARIANTS:
        if seed is None:
            variant = "good"
        else:
            blob = seed if isinstance(seed, bytes) else str(seed).encode("utf-8")
            digest = hashlib.md5(blob).hexdigest()
            variant = _MOCK_ORDER[int(digest, 16) % len(_MOCK_ORDER)]

    raw = dict(MOCK_VARIANTS[variant]["raw"])
    raw["char"] = target_char or "木"

    result = normalize(raw, target_char)
    result["model"] = "mock"
    result["usage"] = {}
    result["retries"] = 0
    result["mock"] = True
    result["mock_variant"] = variant
    result["elapsed"] = 0.0
    return result
