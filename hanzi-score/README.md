# 田字格小老师

给一年级学生的汉字书写打分。上传一张田字格照片（格子里写着一个字），
程序在本地量出字和标准写法的几何差距，直接换算成分数、一句表扬、
最多三条改进点；**低于 60 分就建议擦掉重写**。

**纯本地、不调 LLM**：找格子、提笔迹、OCR 认字、几何比对、评分换算
全部在这台机器上完成，不需要 API key，没有外部请求，结果稳定可复现。

老师批改作业时看的就是那几件事：字有没有写在格子正中间、间架散不散、
横平不平竖直不直、笔画有没有写错。这四件事就是这里的四个评分维度，
每一条都由 `core/geometry.py` 量出来的几何指标决定。

## 评分维度（由几何指标换算）

| 维度 | 满分 | 怎么算 |
|------|------|--------|
| 占格位置 | 30 | 字块中心偏移格子中心、大小占比、出格笔画比例 |
| 间架结构 | 25 | 标准笔画中线被手写覆盖的比例（缺笔/整体挪位都会掉分） |
| 笔画形态 | 25 | 手写骨架到标准笔画的平均距离、整体倾斜角、多余笔画 |
| 笔画正确 | 20 | OCR 认字是否等于目标字、疑似缺几笔、多余笔画簇 |

扣分力度都是 `core/scorer.py` 顶部的常量，调手感只动那一段。

等级线：**≥90 优秀**（小状元）｜**75-89 良好**｜**60-74 合格**｜**<60 需重写**。

两条额外的硬规则：

- **「笔画正确」低于 10 分直接判重写**，不看总分 —— 字写错了再漂亮也要重写
- 填了目标字而 OCR 认出写的是别的字，同样强制重写

## 怎么跑

```bash
bash hanzi-score/launch_server.sh                  # 启动（后台，纯本地）
bash hanzi-score/launch_server.sh stop | restart | status | foreground
HANZI_PORT=8361 bash hanzi-score/launch_server.sh  # 换端口
```

然后打开 http://localhost:8360/ 。

在 ModelArts notebook 这类只有 Jupyter 网页入口、看不到本地端口的环境里，
把平时打开 JupyterLab 的地址末尾路径（如 `/lab`）换成
`/<notebook-id>/proxy/8360/`（即 TensorBoard 同款代理规则），就能在浏览器里访问
FastAPI 页面 —— 所以前端的静态资源和接口全部用**相对路径**引用，别改回绝对路径。

日志和 pid 在 `logs/<主机名>/server_<port>.{log,pid}` —— 这个目录在多机共享的 NFS 盘上，
各机器常起相同端口的同名服务，不按主机名隔离 `stop` 会拿对方机器的 pid 号杀错本机进程。

依赖（环境里都有，没有 requirements.txt）：`fastapi`、`uvicorn`、`python-multipart`、
`Pillow`、`opencv-python`、`scikit-image`、`rapidocr-onnxruntime`（认字用；
没装时自动退模板匹配，仍可打分）。标准字库来自
`../dataset/hanzi-writer-data`（可用环境变量 `HANZI_DATA_DIR` 覆盖）。

> ⚠️ 服务监听 `0.0.0.0` 且**没有任何登录认证**，谁能连到端口谁就能上传图片。
> 这是个收学生照片的儿童相关应用，**建议只在本机或内网用**，别直接暴露到公网。
> 上传的图**不落盘**，在内存里处理完就丢，不会堆积学生照片。

## 接口

| 端点 | 说明 |
|------|------|
| `GET /` | 页面 |
| `GET /api/health` | `{status, mode, pass_score, full_marks}` |
| `GET /api/rubric` | 评分维度与等级线，前端渲染用 |
| `POST /api/score` | multipart 上传，见下 |

`POST /api/score` 的表单字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `file` | 是 | 田字格照片，≤8MB |
| `target_char` | 否 | 这一格应该写的字。只取第一个汉字；不填则用本地 OCR 认出写的字 |

返回：

```json
{
  "char": "木", "target_char": "木", "char_match": true,
  "total": 84, "full_marks": 100,
  "level": "良好", "badge": "写得不错", "emoji": "⭐",
  "need_rewrite": false, "rewrite_reason": "", "rewrite_advice": null,
  "praise": "第 2 笔写得最准，就照这个感觉写其他的！",
  "improvements": ["字的中心偏右 5%，写到格子正中间更好。"],
  "dimensions": [
    {"key": "grid", "name": "占格位置", "score": 25, "full": 30, "comment": "位置不错，稍微偏上一点"}
  ],
  "geometry": {"ok": true, "char": "木", "lines": ["占格：…"], "metrics": {…}},
  "geometry_overlay": "data:image/png;base64,…",
  "elapsed": 0.6
}
```

`geometry_overlay` 是三层对比图（同一个米字格里）：标准笔画按每笔对齐率着色
（**绿 ≥90% 写到位、黄 60%~90% 部分到位、红 <60% 没写对**），黑色是手写，
红线是标准笔画中线。

错误码：`400` 图片打不开或为空｜`413` 超过 8MB｜`422` 缺 `file`、没找到田字格、
笔迹太淡等打分失败（detail 里有给用户看的中文说明）。

## 打分管线（core/）

1. **找格子**：HSV 取红色格线 → 最大连通域 → 四角点透视归一到 1024×1024
   （与标准字坐标系一致）
2. **提笔迹**：Sauvola 局部阈值抗阴影，剔掉红线和抗锯齿边，去噪点
3. **认字**：轻量 OCR（RapidOCR，PP-OCRv4 ONNX，CPU ~0.1s）；
   没装或置信度低（<0.5）时退模板匹配（3500 常用字），形近候选一并返回
4. **标准字**：来自 hanzi-writer-data（**该数据集实测为 y 轴向上**，README 写反了，
   加载时统一翻转）；比对前把标准字仿射到手写字块上——位置/大小差异由占格指标单独评价
5. **量差异**：占格偏移/大小/出格、每笔到标准位置的距离（距离变换）、
   逐笔覆盖与对齐率（疑似缺笔）、整体倾斜
6. **换算评分**：`core/scorer.py` 里的确定性公式，无随机性

## 目录结构

```
hanzi-score/
├── core/                  # 纯逻辑，不 import fastapi，换外壳时原样复用
│   ├── rubric.py          # 四个维度、等级与重写阈值
│   ├── geometry.py        # 本地几何比对：找格/提笔迹/比对/认字/对比图
│   └── scorer.py          # 几何指标 → 四维度分数 → 等级与重写判定
├── server/
│   ├── app.py             # FastAPI
│   └── static/            # 原生 HTML/CSS/JS，无构建步骤
├── samples/make_samples.py  # 用线段画的田字格测试图（合成图，不是真实手写）
├── test/
├── launch_server.sh
└── README.md
```

## 测试

```bash
python3 hanzi-score/test/test_rubric.py      # 17 项：等级边界、重写判定、分数夹紧
python3 hanzi-score/test/test_scorer.py      # 16 项：打分换算、端到端、失败兜底（全离线）
python3 hanzi-score/test/test_geometry.py    # 14 项：找格/提笔迹/比对/认字（全离线）
python3 hanzi-score/samples/make_samples.py  # 生成 8 张测试图

# 前端（jsdom 真实加载页面走完选图→打分→渲染）
cd /tmp && npm install jsdom --no-save
node hanzi-score/test/web.smoke.js           # 14 项
```

端到端：

```bash
bash hanzi-score/launch_server.sh
curl -s localhost:8360/api/health
curl -s -F "file=@hanzi-score/samples/good_mu.png" -F "target_char=木" \
     localhost:8360/api/score | python3 -m json.tool
curl -s -F "file=@hanzi-score/samples/bad_mu.png" -F "target_char=木" \
     localhost:8360/api/score | python3 -m json.tool     # 分数更低，need_rewrite
```

**还没充分验证的一步**：真实手写照片的评分手感。`samples/` 里是用线段合成的字，
不是真实手写。用真照片试几张，看分数和评语合不合一年级老师的判断，
不合就调 `core/scorer.py` 顶部的扣分常量和 `core/geometry.py` 顶部的比对阈值。
