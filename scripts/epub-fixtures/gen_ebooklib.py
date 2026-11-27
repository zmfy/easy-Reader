"""用 Python ebooklib 生成 EPUB（EPUB3，带 nav 与 NCX、封面）。用法：python gen_ebooklib.py <book.json> <cover.jpg> <输出.epub>"""
import html
import json
import sys

from ebooklib import epub

src, cover, out = sys.argv[1:4]
data = json.load(open(src, encoding='utf-8'))
book = epub.EpubBook()
book.set_identifier('easyreader-fixture-ebooklib')
book.set_title(data['title'])
book.set_language(data['language'])
book.add_author(data['author'])
book.add_metadata('DC', 'description', data['description'])
book.set_cover('cover.jpg', open(cover, 'rb').read())

items = []
for i, ch in enumerate(data['chapters'], 1):
    item = epub.EpubHtml(title=ch['title'], file_name=f'chap_{i:02d}.xhtml', lang='zh')
    item.content = f"<h1>{html.escape(ch['title'])}</h1>" + ''.join(f'<p>{html.escape(p)}</p>' for p in ch['paragraphs'])
    book.add_item(item)
    items.append(item)
book.toc = items
book.add_item(epub.EpubNcx())
book.add_item(epub.EpubNav())
book.spine = ['nav'] + items
epub.write_epub(out, book)
