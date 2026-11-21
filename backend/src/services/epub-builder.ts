import AdmZip from 'adm-zip';

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
function groupChapters(chapters: EpubChapter[], fileOf: (i: number) => string): TocGroup[] {
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

export function buildEpub(input: EpubInput): Buffer {
  const lang = input.language || 'zh';
  const uid = `urn:easyreader:${input.id}`;
  const fileOf = (i: number) => `text/c${String(i + 1).padStart(4, '0')}.xhtml`;
  // 不排序：mimetype 必须是第一项
  const zip = new AdmZip(undefined, { noSort: true });

  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.getEntry('mimetype')!.header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
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
  input.chapters.forEach((c, i) => {
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

  zip.addFile('OEBPS/content.opf', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
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

  const groups = groupChapters(input.chapters, fileOf);

  const navItems = groups.map(g => {
    const lis = g.items.map(it => `<li><a href="${it.file}">${esc(it.title)}</a></li>`).join('\n');
    return g.title === null ? lis : `<li><span>${esc(g.title)}</span>\n<ol>\n${lis}\n</ol></li>`;
  }).join('\n');
  zip.addFile('OEBPS/nav.xhtml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
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
  const navPoint = (title: string, file: string, inner = '') =>
    `<navPoint id="np${++order}" playOrder="${order}"><navLabel><text>${esc(title)}</text></navLabel><content src="${file}"/>${inner}</navPoint>`;
  const ncxPoints = groups.map(g => {
    if (g.title === null) return g.items.map(it => navPoint(it.title, it.file)).join('\n');
    // 分组节点指向组内第一章；先占 playOrder 再生成子节点，保证顺序递增
    const id = ++order;
    const children = g.items.map(it => navPoint(it.title, it.file)).join('\n');
    return `<navPoint id="np${id}" playOrder="${id}"><navLabel><text>${esc(g.title)}</text></navLabel><content src="${g.items[0].file}"/>\n${children}\n</navPoint>`;
  }).join('\n');
  zip.addFile('OEBPS/toc.ncx', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${lang}">
<head><meta name="dtb:uid" content="${esc(uid)}"/></head>
<docTitle><text>${esc(input.title)}</text></docTitle>
<navMap>
${ncxPoints}
</navMap>
</ncx>`));

  zip.addFile('OEBPS/style.css', Buffer.from(STYLE));
  if (input.cover && coverExt) zip.addFile(`OEBPS/cover.${coverExt}`, input.cover.data);

  input.chapters.forEach((c, i) => {
    const body = `<h2>${esc(c.title)}</h2>\n${toXhtmlFragment(c.html)}`;
    zip.addFile(`OEBPS/${fileOf(i)}`, Buffer.from(xhtmlPage(c.title, body, lang)));
  });

  return zip.toBuffer();
}
