import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { ZipWriter } from './zip-writer';

// 由章节生成 EPUB 3（附 EPUB 2 的 toc.ncx，兼容 KOReader 等老阅读器）。
// 用于 OPDS 下载：TXT / UMD 转成带目录、UTF-8 的 EPUB。

export interface EpubChapter {
  title: string;
  /** 章节正文 HTML（解析插件输出的 <p> 段落，已转义） */
  html: string;
  /** 从这一章开始的分组标题（如「第一部」），在目录里作为上一级 */
  groupTitle?: string;
}

export interface EpubInput {
  id: string;
  title: string;
  author?: string | null;
  summary?: string | null;
  language?: string;
  cover?: { data: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' } | null;
  chapters: EpubChapter[];
}

const STYLE = 'body{margin:0 0.5em}h2{text-align:center;margin:1em 0}p{text-indent:2em;line-height:1.6;margin:0.3em 0}';

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: '&#160;', ensp: '&#8194;', emsp: '&#8195;', thinsp: '&#8201;', hellip: '&#8230;',
  mdash: '&#8212;', ndash: '&#8211;', middot: '&#183;', ldquo: '&#8220;', rdquo: '&#8221;',
  lsquo: '&#8216;', rsquo: '&#8217;', copy: '&#169;', reg: '&#174;', times: '&#215;', laquo: '&#171;', raquo: '&#187;',
};

function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 解析插件输出的 HTML → 合法 XHTML 片段：命名实体转数字实体，空元素自闭合 */
function toXhtmlFragment(html: string): string {
  return html
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name: string) => {
      if (['amp', 'lt', 'gt', 'quot', 'apos'].includes(name)) return m;
      return NAMED_ENTITIES[name] ?? `&amp;${name};`;
    })
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/<(br|hr|img)(\s[^<>]*?)?\s*\/?>/gi, (_m, tag: string, attrs = '') => `<${tag}${attrs}/>`);
}

// 解析插件的正文会保留一行章节标题（网页阅读器在标题区去重隐藏）；EPUB 已有 <h2>，去掉开头几段里与标题相同的那一行
const TITLE_SCAN_PARAGRAPHS = 5;
function dropTitleParagraph(html: string, title: string): string {
  const compact = (s: string) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const target = compact(esc(title));
  if (!target) return html;
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>\s*/gi;
  let m: RegExpExecArray | null;
  for (let i = 0; i < TITLE_SCAN_PARAGRAPHS && (m = re.exec(html)); i++) {
    if (compact(m[1]) === target) return html.slice(0, m.index) + html.slice(m.index + m[0].length);
  }
  return html;
}

function xhtmlPage(title: string, body: string, lang: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>
<body>
${body}
</body>
</html>`;
}

interface TocGroup { title: string | null; items: Array<{ title: string; file: string }> }

/** 按 groupTitle 把章节归组：groupTitle 出现时开新组，之后没有 groupTitle 的章节仍留在该组 */
function groupChapters(chapters: Array<{ title: string; groupTitle?: string }>, fileOf: (i: number) => string): TocGroup[] {
  const groups: TocGroup[] = [];
  let current: TocGroup | null = null;
  chapters.forEach((c, i) => {
    if (c.groupTitle && c.groupTitle !== current?.title) {
      current = { title: c.groupTitle, items: [] };
      groups.push(current);
    } else if (!current) {
      current = { title: null, items: [] };
      groups.push(current);
    }
    current.items.push({ title: c.title, file: fileOf(i) });
  });
  return groups;
}

export interface EpubTocEntry {
  title: string;
  groupTitle?: string;
}

export interface EpubStreamInput extends Omit<EpubInput, 'chapters'> {
  /** 各章标题与分组（目录要先写，所以先给全部标题） */
  toc: EpubTocEntry[];
  /** 按需取第 i 章正文 HTML：逐章读取、写入，整本书不会同时在内存里 */
  chapterHtml: (index: number) => Promise<string>;
}

/** 逐章写出 EPUB 到 outPath；内存里只有当前一章，压缩在线程池里做，不阻塞事件循环。失败时删除半成品 */
export async function writeEpub(input: EpubStreamInput, outPath: string): Promise<void> {
  const lang = input.language || 'zh';
  const uid = `urn:easyreader:${input.id}`;
  const fileOf = (i: number) => `text/c${String(i + 1).padStart(4, '0')}.xhtml`;
  const zip = await ZipWriter.open(outPath);
  try {
    await zip.add('mimetype', Buffer.from('application/epub+zip'), { store: true });
    await zip.add('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`));

    const coverExt = input.cover ? input.cover.mimeType.split('/')[1].replace('jpeg', 'jpg') : null;
    const manifest: string[] = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      '<item id="style" href="style.css" media-type="text/css"/>',
    ];
    if (input.cover && coverExt) {
      manifest.push(`<item id="cover-image" href="cover.${coverExt}" media-type="${input.cover.mimeType}" properties="cover-image"/>`);
    }
    const spine: string[] = [];
    input.toc.forEach((_c, i) => {
      const id = `c${i + 1}`;
      manifest.push(`<item id="${id}" href="${fileOf(i)}" media-type="application/xhtml+xml"/>`);
      spine.push(`<itemref idref="${id}"/>`);
    });

    const meta = [
      `<dc:identifier id="uid">${esc(uid)}</dc:identifier>`,
      `<dc:title>${esc(input.title)}</dc:title>`,
      `<dc:language>${lang}</dc:language>`,
      input.author ? `<dc:creator>${esc(input.author)}</dc:creator>` : '',
      input.summary ? `<dc:description>${esc(input.summary)}</dc:description>` : '',
      `<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}</meta>`,
      input.cover ? '<meta name="cover" content="cover-image"/>' : '',
    ].filter(Boolean).join('\n');

    await zip.add('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta}
</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>`));

    const groups = groupChapters(input.toc, fileOf);

    const navItems = groups.map(g => {
      const lis = g.items.map(it => `<li><a href="${it.file}">${esc(it.title)}</a></li>`).join('\n');
      return g.title === null ? lis : `<li><span>${esc(g.title)}</span>\n<ol>\n${lis}\n</ol></li>`;
    }).join('\n');
    await zip.add('OEBPS/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>目录</h1>
<ol>
${navItems}
</ol>
</nav>
</body>
</html>`));

    let order = 0;
    const navPoint = (title: string, file: string) =>
      `<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(title)}</text></navLabel><content src="${file}"/></navPoint>`;
    const ncxPoints = groups.map(g => {
      if (g.title === null) return g.items.map(it => navPoint(it.title, it.file)).join('\n');
      // 分组节点指向组内第一章；先占 playOrder 再生成子节点，保证顺序递增
      const id = ++order;
      const children = g.items.map(it => navPoint(it.title, it.file)).join('\n');
      return `<navPoint id="np${id}" playOrder="${id}"><navLabel><text>${esc(g.title)}</text></navLabel><content src="${g.items[0].file}"/>\n${children}\n</navPoint>`;
    }).join('\n');
    await zip.add('OEBPS/toc.ncx', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${esc(uid)}"/></head>
<docTitle><text>${esc(input.title)}</text></docTitle>
<navMap>
${ncxPoints}
</navMap>
</ncx>`));

    await zip.add('OEBPS/style.css', Buffer.from(STYLE));
    if (input.cover && coverExt) await zip.add(`OEBPS/cover.${coverExt}`, input.cover.data);

    for (let i = 0; i < input.toc.length; i++) {
      const title = input.toc[i].title;
      const html = await input.chapterHtml(i);
      const body = `<h2>${esc(title)}</h2>\n${toXhtmlFragment(dropTitleParagraph(html, title))}`;
      await zip.add(`OEBPS/${fileOf(i)}`, Buffer.from(xhtmlPage(title, body, lang)));
    }
    await zip.close();
  } catch (err) {
    await zip.abort();
    throw err;
  }
}

/** 章节已全部在内存里时的便捷写法（小书、测试用） */
export async function buildEpub(input: EpubInput): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `epub-${crypto.randomBytes(6).toString('hex')}.epub`);
  try {
    await writeEpub({ ...input, toc: input.chapters, chapterHtml: async i => input.chapters[i].html }, tmp);
    return await fs.promises.readFile(tmp);
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}
