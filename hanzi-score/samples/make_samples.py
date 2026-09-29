#!/usr/bin/env python3
"""生成田字格测试图，用来验证服务链路和前端渲染。

注意：这台机器上没有中文字体（只有 DejaVu，不含 CJK 字形），所以不能用
Pillow 直接把汉字渲染出来。这里改成**用线段画字**——一年级的「一 十 人 木」
几个字都能用直线拼出来。

画出来的是合成线稿，不是真实手写，只够跑通「上传 → 打分 → 渲染」这条链路。
真实打分质量要用真照片 + 真 API key 验证。

用法：
    python3 hanzi-score/samples/make_samples.py
    python3 hanzi-score/samples/make_samples.py --out /tmp/hanzi_samples
"""

import argparse
import os

from PIL import Image, ImageDraw

SIZE = 480           # 输出图边长（正方形，正好一格田字格）
MARGIN = 24          # 田字格边框到图片边缘的留白
INK = (34, 34, 34)   # 笔迹颜色，仿铅笔的深灰
GRID = (214, 92, 92)  # 田字格线颜色，仿作业本的淡红
BG = (252, 250, 245)  # 纸张底色


def draw_grid(draw: ImageDraw.ImageDraw) -> tuple:
    """画田字格：外框 + 虚线的横中线/竖中线。返回格子的 (left, top, right, bottom)。"""
    left, top = MARGIN, MARGIN
    right, bottom = SIZE - MARGIN, SIZE - MARGIN

    draw.rectangle([left, top, right, bottom], outline=GRID, width=3)

    cx = (left + right) // 2
    cy = (top + bottom) // 2

    # 虚线中线：每 14px 画 8px
    for x in range(left, right, 14):
        draw.line([x, cy, min(x + 8, right), cy], fill=GRID, width=2)
    for y in range(top, bottom, 14):
        draw.line([cx, y, cx, min(y + 8, bottom)], fill=GRID, width=2)

    return left, top, right, bottom


def strokes_for(char: str) -> list:
    """返回某个字的笔画，坐标是格子内的相对比例 (0~1)。

    每个笔画是 [(x1, y1), (x2, y2), ...] 的折线。
    """
    if char == "一":
        return [[(0.20, 0.50), (0.80, 0.50)]]
    if char == "十":
        return [
            [(0.18, 0.50), (0.82, 0.50)],   # 横
            [(0.50, 0.15), (0.50, 0.85)],   # 竖
        ]
    if char == "人":
        return [
            [(0.50, 0.20), (0.24, 0.82)],   # 撇
            [(0.50, 0.20), (0.78, 0.82)],   # 捺
        ]
    if char == "木":
        return [
            [(0.16, 0.38), (0.84, 0.38)],   # 横
            [(0.50, 0.14), (0.50, 0.88)],   # 竖
            [(0.50, 0.44), (0.20, 0.84)],   # 撇
            [(0.50, 0.44), (0.80, 0.84)],   # 捺
        ]
    raise ValueError(f"没有定义这个字的笔画: {char!r}")


def render(char: str, *, bad: bool) -> Image.Image:
    """把字画进田字格。bad=True 时故意写歪、写大、写偏，用来走低分那条分支。"""
    img = Image.new("RGB", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(img)
    left, top, right, bottom = draw_grid(draw)
    cell = right - left

    # 好的：居中、占格约 70%。差的：放大到超出格子，并整体右下偏移
    scale = 1.35 if bad else 1.0
    shift_x = 0.13 if bad else 0.0
    shift_y = 0.10 if bad else 0.0

    for stroke in strokes_for(char):
        points = []
        for i, (rx, ry) in enumerate(stroke):
            # 以格心为原点缩放，再整体偏移
            sx = (rx - 0.5) * scale + 0.5 + shift_x
            sy = (ry - 0.5) * scale + 0.5 + shift_y
            # bad 的字让后半段再歪一点，模拟笔画写斜
            if bad and i > 0:
                sx += 0.04
                sy -= 0.03
            points.append((left + sx * cell, top + sy * cell))
        draw.line(points, fill=INK, width=9, joint="curve")

    return img


SAMPLES = ["一", "十", "人", "木"]
PINYIN = {"一": "yi", "十": "shi", "人": "ren", "木": "mu"}


def render_sheet(n: int = 2, char: str = "木", *, bad: bool = False) -> Image.Image:
    """n 个格子横排的一张练习纸（每格写同一个字），用来测多格分割和逐格打分。"""
    gap = 40
    img = Image.new("RGB", (SIZE * n + gap * (n + 1), SIZE + 80), BG)
    for i in range(n):
        base = render(char, bad=bad)
        img.paste(base, (gap + i * (SIZE + gap), 40))
    return img


def main() -> None:
    parser = argparse.ArgumentParser(description="生成田字格测试图")
    parser.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)),
                        help="输出目录（默认就是 samples/ 自己）")
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    for char in SAMPLES:
        for bad in (False, True):
            prefix = "bad" if bad else "good"
            path = os.path.join(args.out, f"{prefix}_{PINYIN[char]}.png")
            render(char, bad=bad).save(path)
            print(f"[samples] {path}")

    print(f"[samples] 共 {len(SAMPLES) * 2} 张。这些是线段合成图，不是真实手写。")


if __name__ == "__main__":
    main()
