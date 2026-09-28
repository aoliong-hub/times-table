# -*- coding: utf-8 -*-
"""田字格小老师 —— 汉字书写打分的 FastAPI 网页版。

    python server/app.py --port 8360          # 真实打分（需要 LLM_API_KEY）
    python server/app.py --mock               # 离线演示，不联网

打分逻辑全在 core/ 里，这个文件只负责 HTTP 和静态页面；换成小程序后端或 CLI
的时候把这一层换掉即可，core/ 原样复用。

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
API_KEY_ENVS = ("LLM_API_KEY", "API_KEY", "YIBU_API_KEY")

# 运行期开关，main() 里按命令行参数改写
STATE = {
    "mock": os.environ.get("HANZI_MOCK", "").lower() in ("1", "true", "yes"),
    "model": scorer.DEFAULT_MODEL,
}

app = FastAPI(title="田字格小老师", description="一年级汉字书写打分")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def has_api_key():
    """服务端环境里有没有配 key。只回布尔值，key 本身绝不出现在响应里。"""
    return any(os.environ.get(name) for name in API_KEY_ENVS)


@app.get("/", response_class=HTMLResponse)
def index():
    """整页 HTML 直接读文件返回，改前端不用重启服务。"""
    with open(os.path.join(STATIC_DIR, "index.html"), encoding="utf-8") as fh:
        return fh.read()


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "mock": STATE["mock"],
        "has_api_key": has_api_key(),      # 只报有没有，不报是什么
        "model": "mock" if STATE["mock"] else STATE["model"],
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
    api_key: str = Form(""),
    mock_variant: str = Form(""),
):
    """上传一张田字格练字图，返回打分结果。

    target_char  可选，这一格应该写的字（只取第一个汉字）
    api_key      可选，覆盖服务端环境变量里的 key；不记日志、不回传
    mock_variant 只在 mock 模式下有效，用来指定演示数据的形态
    """
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="没有收到图片")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail="图片太大了（超过 %dMB），拍小一点或压缩一下" % (MAX_UPLOAD_BYTES // 1024 // 1024),
        )

    # 先确认是张能解开的图，别把坏文件送进模型
    try:
        Image.open(io.BytesIO(data)).verify()
    except Exception:
        raise HTTPException(status_code=400, detail="图片打不开，换一张试试")

    mock = STATE["mock"]
    if not mock and not (api_key or has_api_key()):
        raise HTTPException(
            status_code=503,
            detail="服务端没有配 API key。设置 LLM_API_KEY 后重启，或用 --mock 起演示模式。",
        )

    try:
        return scorer.score_image(
            image_bytes=data,
            target_char=target_char,
            model=STATE["model"],
            api_key=api_key or None,
            mock=mock,
            mock_variant=mock_variant or None,
        )
    except scorer.ScoreError as exc:
        raise HTTPException(status_code=502, detail=exc.detail)


def main():
    parser = argparse.ArgumentParser(description="田字格小老师 - 汉字书写打分服务")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--model", default=scorer.DEFAULT_MODEL, help="打分用的多模态模型")
    parser.add_argument("--mock", action="store_true",
                        help="离线演示：不联网，返回构造好的假评分")
    args = parser.parse_args()

    STATE["mock"] = args.mock or STATE["mock"]
    STATE["model"] = args.model

    import uvicorn
    print("[hanzi-score] http://%s:%d  mock=%s  model=%s  has_api_key=%s"
          % (args.host, args.port, STATE["mock"], STATE["model"], has_api_key()))
    if not STATE["mock"] and not has_api_key():
        print("[hanzi-score] 警告：没有检测到 LLM_API_KEY，打分会返回 503。"
              "先 export LLM_API_KEY=... 或加 --mock 起演示模式。")
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
