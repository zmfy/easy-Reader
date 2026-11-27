"""用 reportlab 按 book.json 生成每章一页的 PDF。

用法：python gen_reportlab.py <book.json> <模式> <输出.pdf> [中文字体.ttc]
  cid      内置 CID 字体 STSong-Light：不嵌入字体、没有 ToUnicode（靠预定义 CMap 映射）
  ttf      嵌入中文 TrueType 字体（需要字体路径）
  scanned  每页一张用字体画出来的文字图片，没有文字层（扫描版）
"""
import json
import sys

from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas

src, mode, out = sys.argv[1:4]
font_path = sys.argv[4] if len(sys.argv) > 4 else None
book = json.load(open(src, encoding='utf-8'))
W, H = A5

if mode == 'cid':
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
    font = 'STSong-Light'
elif mode in ('ttf', 'scanned'):
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    pdfmetrics.registerFont(TTFont('CJK', font_path, subfontIndex=0))
    font = 'CJK'

c = canvas.Canvas(out, pagesize=A5)
c.setTitle(book['title'])
c.setAuthor(book['author'])
c.setSubject(book['description'])

def wrap(text, n=20):
    return [text[i:i + n] for i in range(0, len(text), n)]

for ch in book['chapters']:
    lines = [ch['title'], ''] + [l for p in ch['paragraphs'] for l in wrap(p)]
    if mode == 'scanned':
        from PIL import Image, ImageDraw, ImageFont
        from reportlab.lib.utils import ImageReader
        img = Image.new('L', (int(W * 2), int(H * 2)), 255)
        draw = ImageDraw.Draw(img)
        pil_font = ImageFont.truetype(font_path, 24, index=0)
        for i, line in enumerate(lines):
            draw.text((60, 80 + i * 40), line, font=pil_font, fill=0)
        c.drawImage(ImageReader(img), 0, 0, W, H)
    else:
        y = H - 60
        for i, line in enumerate(lines):
            c.setFont(font, 16 if i == 0 else 11)
            c.drawString(40, y, line)
            y -= 26 if i == 0 else 18
    c.showPage()
c.save()
