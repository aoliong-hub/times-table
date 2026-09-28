# -*- coding: utf-8 -*-
"""汉字书写打分核心：评分规则（rubric）+ 打分流程（scorer）。

不依赖 FastAPI，换任何外壳都能直接用：

    from core.scorer import score_image, ScoreError
    result = score_image(image_path="a.jpg", target_char="木")
"""

from . import rubric            # noqa: F401
from .scorer import (           # noqa: F401
    DEFAULT_MODEL,
    ScoreError,
    build_messages,
    clean_target_char,
    mock_result,
    normalize,
    score_image,
)
