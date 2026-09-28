# -*- coding: utf-8 -*-
"""汉字书写评分规则：一年级田字格练字的评分维度、书写要点、等级阈值。

纯数据 + 纯函数，不 import 任何第三方库，也不碰网络。
第二阶段换外壳（小程序后端 / CLI 批量 / 嵌进静态页）时，这个文件原样复用。
"""

# 四个评分维度，full 相加 = 100。
# checks 既是喂给模型的判分依据，也是 README 里的维度说明，只写一份、两边共用。
DIMENSIONS = [
    {
        "key": "grid",
        "name": "占格位置",
        "full": 30,
        "checks": [
            "整个字写在田字格正中间，不挤在某一边，也不顶出格子",
            "字的大小约占格子的三分之二到四分之三：太小显空，太大顶格",
            "上下左右的留白大致相等",
            "主笔（长横、长竖）要压住横中线或竖中线",
        ],
    },
    {
        "key": "structure",
        "name": "间架结构",
        "full": 25,
        "checks": [
            "部件比例合乎这个字的结构：左右结构看左窄右宽还是左右均分，上下结构看上小下大还是上大下小",
            "笔画之间的间距匀称，不要一边挤成一团、一边空一大片",
            "该交叉的交叉到位，该相接的不脱开、不穿出太多",
            "整个字重心平稳，不左倾右倒",
        ],
    },
    {
        "key": "stroke_shape",
        "name": "笔画形态",
        "full": 25,
        "checks": [
            "横要平（略微右上斜可以），竖要直，不弯不飘",
            "撇要撇出尖，捺要写舒展，点要有形状而不是一小杠",
            "起笔收笔干净，不拖尾巴、不带多余的小钩",
            "折角清楚，横折竖折要有明显转角而不是画成圆弧",
            "线条实在，不重描、不涂改、没有墨团",
        ],
    },
    {
        "key": "correctness",
        "name": "笔画正确",
        "full": 20,
        "checks": [
            "笔画数和目标字一致，不多笔不少笔",
            "没有写成另一个字（别字），也没有写成不存在的字",
            "笔画种类没写错：该是撇的不写成竖，该是点的不写成横",
        ],
    },
]

FULL_MARKS = sum(d["full"] for d in DIMENSIONS)  # 100

# 等级按 min_score 从高到低匹配，第一个满足 total >= min_score 的就是它的等级。
LEVELS = [
    {"min_score": 90, "name": "优秀", "badge": "小状元", "emoji": "🏆"},
    {"min_score": 75, "name": "良好", "badge": "写得不错", "emoji": "⭐"},
    {"min_score": 60, "name": "合格", "badge": "过关啦", "emoji": "👍"},
    {"min_score": 0, "name": "需重写", "badge": "再写一遍", "emoji": "✏️"},
]

PASS_SCORE = 60          # 低于这个分就建议重写
CORRECTNESS_MIN = 10     # 笔画正确分低于这个值 = 字写错了，无论总分多少都要重写
MAX_IMPROVEMENTS = 3     # 一次最多给三条改进点，多了一年级孩子记不住

# 模型没给出 praise 时的兜底（先夸再改，是这个工具的基本调子）
DEFAULT_PRAISE = "能自己写完一整个字，已经很棒了！"


def dimension_map():
    """{key: 维度dict}，方便按 key 取。"""
    return {d["key"]: d for d in DIMENSIONS}


def get_dimension(key):
    """按 key 取维度定义，取不到返回 None。"""
    return dimension_map().get(key)


def clamp_score(key, value):
    """把某维度的分数夹到 [0, full] 的整数。看不懂的值一律当 0 分。

    模型偶尔会给出 35/30 这种越界分、或者字符串、或者 None，这里统一兜住。
    """
    dim = get_dimension(key)
    full = dim["full"] if dim else 0
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return 0
    return max(0, min(full, score))


def level_of(total):
    """按总分取等级 dict（name / badge / emoji / min_score）。"""
    for level in LEVELS:
        if total >= level["min_score"]:
            return level
    return LEVELS[-1]


def grade(total, scores=None):
    """判等级和是否需要重写。

    Args:
        total:  总分（0-100）。
        scores: {维度key: 分数}，用来看「笔画正确」这一项。可以不传。

    Returns:
        {"level", "badge", "emoji", "need_rewrite", "rewrite_reason"}
        rewrite_reason 只在 need_rewrite 时非空，用来告诉前端为什么要重写。
    """
    scores = scores or {}
    level = level_of(total)

    need_rewrite = total < PASS_SCORE
    reason = "总分不到 %d 分" % PASS_SCORE if need_rewrite else ""

    # 字写错了再漂亮也得重写，这条优先于总分
    correctness = scores.get("correctness")
    if correctness is not None and correctness < CORRECTNESS_MIN:
        need_rewrite = True
        reason = "这个字写错了或者缺了笔画"

    return {
        "level": level["name"],
        "badge": level["badge"],
        "emoji": level["emoji"],
        "need_rewrite": need_rewrite,
        "rewrite_reason": reason,
    }


def writing_guide_text():
    """把 DIMENSIONS 拼成喂给模型的「汉字书写要点」段落。"""
    lines = []
    for i, dim in enumerate(DIMENSIONS, 1):
        lines.append("%d. %s（满分 %d 分）" % (i, dim["name"], dim["full"]))
        for check in dim["checks"]:
            lines.append("   - " + check)
    return "\n".join(lines)
