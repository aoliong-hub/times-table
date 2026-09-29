# -*- coding: utf-8 -*-
"""田字格小老师 —— 汉字书写打分的 FastAPI 网页版。

    python server/app.py --port 8360

打分是纯本地的：core/geometry.py 找格子、提笔迹、OCR 认字、与标准字比对，
core/scorer.py 把几何指标换算成四维度评分。不调 LLM、不需要 API key。
这个文件只负责 HTTP 和静态页面；换小程序后端或 CLI 时把这一层换掉即可。

注意：服务监听 0.0.0.0 且没有任何认证，接收的是学生练习照片，只在本机或内网用。
"""

import argparse
import io
import os
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.abspath(os.path.join(_HERE, ".."))     # hanzi-score/
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from core import rubric, scorer  # noqa: E402

STATIC_DIR = os.path.join(_HERE, "static")
MAX_UPLOAD_BYTES = 8 * 1024 * 1024          # 8MB，手机直出照片够用
DEFAULT_PORT = int(os.environ.get("HANZI_PORT", "8360"))

app = FastAPI(title="田字格小老师", description="一年级汉字书写打分")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    """整页 HTML 直接读文件返回，改前端不用重启服务。"""
    with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as fh:
        return fh.read()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mode": "local",
        "pass_score": rubric.PASS_SCORE,
        "full_marks": rubric.FULL_MARKS,
    }


@app.get("/api/rubric")
def get_rubric():
    """评分维度和等级线，给前端渲染用，免得前后端各写一份。"""
    return {
        "dimensions": [
            {"key": d["key"], "name": d["name"], "full": d["full"],
             "checks": d["checks"]}
            for d in rubric.DIMENSIONS
        ],
        "levels": rubric.LEVELS,
        "pass_score": rubric.PASS_SCORE,
        "full_marks": rubric.FULL_MARKS,
    }


@app.post("/api/score")
async def api_score(
    file: UploadFile = File(...),
    target_char: str = Form(""),
):
    """上传一张田字格练字图，返回打分结果。

    target_char 可选，这一格应该写的字（只取第一个汉字）；
    不填则用本地 OCR 认出照片里写的字。
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="没有收到图片")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="图片太大了（超过 %dMB），拍小一点或压缩一下" % (MAX_UPLOAD_BYTES // 1024 // 1024),
        )

    # 先确认是张能解开的图，别把坏文件送进打分管线
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(status_code=400, detail="图片打不开，换一张试试")

    try:
        return scorer.score_image_multi(image_bytes=data, target_char=target_char)
    except scorer.ScoreError as exc:
        raise HTTPException(status_code=422, detail=exc.detail)


def main():
    parser = argparse.ArgumentParser(description="田字格小老师 - 汉字书写打分服务")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    args = parser.parse_args()

    import uvicorn
    print("[hanzi-score] http://%s:%d  模式=本地（找格/OCR/几何比对，不调外部服务）"
          % (args.host, args.port))
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
