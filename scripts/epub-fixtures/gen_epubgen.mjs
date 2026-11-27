// 用 Node epub-gen-memory 生成 EPUB。用法：node gen_epubgen.mjs <book.json> <cover.jpg> <输出.epub>
import fs from 'fs';
import epub from 'epub-gen-memory';

const [src, cover, out] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const content = data.chapters.map(ch => ({
  title: ch.title,
  content: ch.paragraphs.map(p => `<p>${esc(p)}</p>`).join(''),
}));
const buf = await (epub.default || epub)({
  title: data.title,
  author: data.author,
  description: data.description,
  lang: data.language,
  cover: new File([fs.readFileSync(cover)], 'cover.jpg', { type: 'image/jpeg' }),
}, content);
fs.writeFileSync(out, buf);
