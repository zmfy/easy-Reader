"""由 book.json 生成各工具的输入：book.md（pandoc）、book.html（Calibre）、cover.jpg（自绘纯色封面）。

在 python 容器里运行（需要 pillow）：python prepare.py <输出目录>
"""
import html
import json
import os
import sys

from PIL import Image, ImageDraw

here = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1]
book = json.load(open(os.path.join(here, 'book.json'), encoding='utf-8'))

with open(os.path.join(out, 'book.md'), 'w', encoding='utf-8') as f:
    for ch in book['chapters']:
        f.write(f"# {ch['title']}\n\n")
        for p in ch['paragraphs']:
            f.write(p + '\n\n')

with open(os.path.join(out, 'book.html'), 'w', encoding='utf-8') as f:
    f.write('<!DOCTYPE html>\n<html lang="zh"><head><meta charset="utf-8">'
            f"<title>{html.escape(book['title'])}</title>"
            f'<meta name="author" content="{html.escape(book["author"])}"></head><body>\n')
    for ch in book['chapters']:
        f.write(f"<h1>{html.escape(ch['title'])}</h1>\n")
        for p in ch['paragraphs']:
            f.write(f'<p>{html.escape(p)}</p>\n')
    f.write('</body></html>\n')

# 600x800 纯色封面加几条色块（不含文字，避免字体依赖）；JPEG 质量固定，结果可复现
img = Image.new('RGB', (600, 800), (67, 56, 202))
draw = ImageDraw.Draw(img)
for i, color in enumerate([(238, 241, 246), (199, 210, 254), (165, 180, 252)]):
    draw.rectangle([60, 200 + i * 90, 540, 260 + i * 90], fill=color)
img.save(os.path.join(out, 'cover.jpg'), 'JPEG', quality=85)
