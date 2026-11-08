#!/usr/bin/env python3
"""生成应用图标：靛青底 + 白色打开的书。用法：python3 scripts/gen-icons.py（需 Pillow）。
输出 public/favicon.svg 与 public/icons/*.png；几何在 512 坐标系中定义，SVG 与 PNG 共用。"""
from pathlib import Path
from PIL import Image, ImageDraw

ACCENT = '#4338ca'
LINE = '#a5b4fc'
OUT = Path(__file__).resolve().parent.parent / 'public'

# 512 坐标系：左右两页（四边形）与页面上的文字线
LEFT = [(92, 160), (246, 190), (246, 382), (92, 352)]
RIGHT = [(420, 160), (266, 190), (266, 382), (420, 352)]
LINES = [((122, 214), (216, 232)), ((122, 258), (216, 276)), ((122, 302), (186, 314)),
         ((390, 214), (296, 232)), ((390, 258), (296, 276)), ((390, 302), (326, 314))]


def scale(pts, k):
    return [(256 + (x - 256) * k, 256 + (y - 256) * k) for x, y in pts]


def svg():
    poly = lambda p: ' '.join(f'{x},{y}' for x, y in p)
    lines = ''.join(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}"/>' for a, b in LINES)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
            f'<rect width="512" height="512" rx="112" fill="{ACCENT}"/>'
            f'<g fill="#fff">'
            f'<polygon points="{poly(LEFT)}"/><polygon points="{poly(RIGHT)}"/></g>'
            f'<g stroke="{LINE}" stroke-width="12" stroke-linecap="round">{lines}</g></svg>\n')


def png(size, k, rounded, path):
    s = 4  # 超采样
    n = size * s
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    f = n / 512
    if rounded:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=112 * f, fill=ACCENT)
    else:
        d.rectangle([0, 0, n, n], fill=ACCENT)
    for page in (LEFT, RIGHT):
        pts = [(x * f, y * f) for x, y in scale(page, k)]
        d.polygon(pts, fill='white')
    for a, b in LINES:
        (x1, y1), (x2, y2) = scale([a, b], k)
        w = int(12 * f * k)
        d.line([(x1 * f, y1 * f), (x2 * f, y2 * f)], fill=LINE, width=w)
        for x, y in ((x1, y1), (x2, y2)):
            r = w / 2
            d.ellipse([x * f - r, y * f - r, x * f + r, y * f + r], fill=LINE)
    img.resize((size, size), Image.LANCZOS).save(path)


if __name__ == '__main__':
    (OUT / 'icons').mkdir(parents=True, exist_ok=True)
    (OUT / 'favicon.svg').write_text(svg())
    png(192, 1, True, OUT / 'icons' / 'icon-192.png')
    png(512, 1, True, OUT / 'icons' / 'icon-512.png')
    # maskable：系统会按自身形状裁切，铺满底色，主体缩进 80% 安全区
    png(512, 0.8, False, OUT / 'icons' / 'icon-maskable-512.png')
    # iOS 自动加圆角：铺满底色
    png(180, 0.9, False, OUT / 'icons' / 'apple-touch-icon-180.png')
