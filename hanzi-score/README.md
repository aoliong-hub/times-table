# 田字格小老师

给一年级学生的汉字书写打分。上传一张田字格照片（格子里写着一个字），
结合汉字书写要点给出分数、一句表扬、最多三条改进点；**低于 60 分就建议擦掉重写**。

老师批改作业时看的就是那几件事：字有没有写在格子正中间、间架散不散、
横平不平竖直不直、笔画有没有写错。这四件事就是这里的四个评分维度。

## 评分维度

| 维度 | 满分 | 看什么 |
|------|------|--------|
| 占格位置 | 30 | 写在格子正中、大小合适、四周留白匀称、主笔压住中线 |
| 间架结构 | 25 | 部件比例、笔画间距匀称、该交叉的交叉到位、重心平稳 |
| 笔画形态 | 25 | 横平竖直、撇尖捺展、起收笔干净、折角清楚、不重描涂改 |
| 笔画正确 | 20 | 笔画数对不对、有没有写成别字、笔画种类没写错 |

等级线：**≥90 优秀**（小状元）｜**75-89 良好**｜**60-74 合格**｜**<60 需重写**。

两条额外的硬规则：

- **「笔画正确」低于 10 分直接判重写**，不看总分 —— 字写错了再漂亮也要重写
- 填了目标字而模型认出来的是别的字，同样强制重写

总分由**服务端按四项累加**，不采信模型自己报的总分（模型常把加法算错）。

## 怎么跑

```bash
# 演示模式：不联网、不需要 key，返回构造好的假评分，用来看页面效果
HANZI_MOCK=1 bash hanzi-score/launch_server.sh

# 真实打分：需要 LLM_API_KEY（见 ../../llm_client/README.md）
bash hanzi-score/launch_server.sh

# 其它子命令
bash hanzi-score/launch_server.sh stop | restart | status | foreground
```

然后打开 http://localhost:8360/ 。端口用 `HANZI_PORT` 换，模型用 `HANZI_MODEL` 换
（默认 `gemini-3.5-flash`，得是支持看图的多模态模型）。

在 ModelArts notebook 这类只有 Jupyter 网页入口、看不到本地端口的环境里，
把平时打开 JupyterLab 的地址末尾路径（如 `/lab`）换成
`/<notebook-id>/proxy/8360/`（即 TensorBoard 同款代理规则），就能在浏览器里访问
FastAPI 页面 —— 所以前端的静态资源和接口全部用**相对路径**引用，别改回绝对路径。

日志和 pid 在 `logs/<主机名>/server_<port>.{log,pid}` —— 这个目录在多机共享的 NFS 盘上，
各机器常起相同端口的同名服务，不按主机名隔离 `stop` 会拿对方机器的 pid 号杀错本机进程。

依赖（环境里都有，没有 requirements.txt）：`fastapi`、`uvicorn`、`python-multipart`、
`Pillow`、`openai`（真实打分时才用到）。

> ⚠️ 服务监听 `0.0.0.0` 且**没有任何登录认证**，谁能连到端口谁就能上传图片、消耗 API 额度。
> 这是个收学生照片的儿童相关应用，**建议只在本机或内网用**，别直接暴露到公网。
> 上传的图**不落盘**，在内存里编码完就丢，不会堆积学生照片。

## 接口

| 端点 | 说明 |
|------|------|
| `GET /` | 页面 |
| `GET /api/health` | `{status, mock, has_api_key, model, pass_score, full_marks}`。只报有没有配 key，不回传 key 本身 |
| `GET /api/rubric` | 评分维度与等级线，前端渲染用 |
| `POST /api/score` | multipart 上传，见下 |

`POST /api/score` 的表单字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | 田字格照片，≤8MB |
| `target_char` | 否 | 这一格应该写的字。只取第一个汉字；填了能判错字和缺笔画，不填则让模型先认字 |
| `api_key` | 否 | 覆盖服务端环境变量里的 key。不写日志、不回传 |
| `mock_variant` | 否 | 仅演示模式有效：`excellent` / `good` / `pass` / `rewrite`，指定假数据形态 |

返回：

```json
{
  "char": "木", "target_char": "木", "char_match": true,
  "total": 84, "full_marks": 100,
  "level": "良好", "badge": "写得不错", "emoji": "⭐",
  "need_rewrite": false, "rewrite_reason": "", "rewrite_advice": null,
  "praise": "横写得又平又稳，像小桌子的桌面！",
  "improvements": ["整个字往下挪一点，让上下留白一样多。"],
  "dimensions": [
    {"key": "grid", "name": "占格位置", "score": 25, "full": 30, "comment": "位置不错，稍微偏上一点"}
  ],
  "model": "mock", "usage": {}, "retries": 0, "mock": true, "elapsed": 0.0
}
```

错误码：`400` 图片打不开或为空｜`413` 超过 8MB｜`422` 缺 `file`｜
`502` 模型调用失败或没按格式回答｜`503` 真实模式下服务端没配 key。

## 本地几何比对（打分前先量一量）

调 LLM 之前，先用图像处理把可量化的差异量出来，再连同照片一起交给模型：

1. **找格子**：HSV 取红色格线 → 最大连通域 → 四角点透视归一到 1024×1024
   （与标准字坐标系一致）
2. **提笔迹**：Sauvola 局部阈值抗阴影，剔掉红线和抗锯齿边，去噪点
3. **标准字**：来自 `../dataset/hanzi-writer-data`（`medians` 逐笔中线，
   注意该数据集实测为 **y 轴向上**，README 写反了，加载时统一翻转），
   比对前先把标准字仿射到手写字块上——位置/大小差异由占格指标单独评价
4. **量差异**：占格中心偏移/大小比例/出格占比、每笔到标准位置的距离
   （距离变换）、逐笔覆盖（疑似缺笔）、整体倾斜；标准笔画渲染线宽取
   手写实测笔画宽，把「写得粗」从形状偏差里消掉
5. **认字**：目标字没填时用轻量 OCR（RapidOCR，PP-OCRv4 ONNX，CPU ~0.1s）
   认出照片里的字；OCR 没装或置信度低（<0.5）时退模板匹配（3500 常用字
   逐个比对，首次构建约 6 秒），并把形近候选一并列给 LLM 确认

几何结果不直接改分数：中文摘要 + 「标准笔画红线叠加图」注入用户提示词，
LLM 结合照片自己看。**几何环节任何失败都静默降级**（响应里 `geometry: null`），
打分照常进行。阈值常量集中在 `core/geometry.py` 顶部，真照片调参只动那里。

前端结果卡里有「程序量了量」区块：几行中文 + 红线叠加图，判空隐藏。

## 目录结构

```
hanzi-score/
├── core/                  # 纯逻辑，不 import fastapi，换外壳时原样复用
│   ├── rubric.py          # 书写要点、四个维度、等级与重写阈值
│   ├── geometry.py        # 本地几何比对：找格/提笔迹/比对/认字/叠加图
│   └── scorer.py          # 提示词构造、几何注入、调 llm_client、归一化、mock
├── server/
│   ├── app.py             # FastAPI
│   └── static/            # 原生 HTML/CSS/JS，无构建步骤
├── samples/make_samples.py  # 用线段画的田字格测试图（合成图，不是真实手写）
├── test/
├── launch_server.sh
└── README.md
```

真实调用走同级目录的 `llm_client`（`project="hanzi_score"`，用量进
`code/llm_logs/usage_log-YYYYMM.jsonl`），不自己封 openai SDK。

## 测试

```bash
python3 hanzi-score/test/test_rubric.py      # 17 项：等级边界、重写判定、分数夹紧
python3 hanzi-score/test/test_scorer.py      # 29 项：提示词、几何注入、归一化兜底、mock
python3 hanzi-score/test/test_geometry.py    # 14 项：找格/提笔迹/比对/认字（全离线）
python3 hanzi-score/samples/make_samples.py  # 生成 8 张测试图

# 前端（jsdom 真实加载页面走完选图→打分→渲染）
cd /tmp && npm install jsdom --no-save
node hanzi-score/test/web.smoke.js           # 16 项
```

端到端（演示模式，不联网）：

```bash
HANZI_MOCK=1 bash hanzi-score/launch_server.sh
curl -s localhost:8360/api/health
curl -s -F "file=@hanzi-score/samples/good_mu.png" -F "target_char=木" \
     localhost:8360/api/score | python3 -m json.tool     # 84 分，良好
curl -s -F "file=@hanzi-score/samples/bad_mu.png" -F "target_char=木" \
     localhost:8360/api/score | python3 -m json.tool     # 46 分，need_rewrite: true
```

**还没充分验证的一步**：真实手写照片的打分质量。`samples/` 里是用线段合成的字，
不是真实手写；真实链路只在开发环境打过一张合成图。用真照片试几张，看几何指标
和评语合不合一年级老师的判断，不合就调 `core/geometry.py` 顶部的阈值常量、
`core/scorer.py` 里的打分尺度那几句。另外认字用的 RapidOCR 需要联网装一次
（`pip install rapidocr-onnxruntime`，模型内置），没装时自动退模板匹配。

## 下一步：换外壳

`core/` 不依赖 FastAPI 也不碰 HTTP，改成别的形态只换外壳：

- 微信小程序 —— 前端换成 wxml/wxss，`POST /api/score` 照用（小程序要配服务器域名和 HTTPS）
- CLI 批量 —— 直接 `scorer.score_image(image_path=..., target_char=...)`
- 嵌进现有静态页 —— 根目录「动手建造区」那套主题变量本来就共用，样式能直接搬
