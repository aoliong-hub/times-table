# -*- coding: utf-8 -*-
"""汉字书写打分核心：评分规则（rubric）+ 几何比对（geometry）+ 打分流程（scorer）。

纯本地、不依赖 FastAPI、不调外部服务，换任何外壳都能直接用：

    from core.scorer import score_image, ScoreError
    result = score_image(image_path="a.jpg", target_char="木")
"""

from . import geometry, rubric  # noqa: F401
from .scorer import (           # noqa: F401
    ScoreError,
    clean_target_char,
    score_image,
)
