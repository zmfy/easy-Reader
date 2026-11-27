import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { EpubParser } from '../../src/plugins/parser-epub';
import { checkEpubHealth } from '../../src/services/epub-health';
import { chapterParagraphs } from '../../src/services/ai-reading';

/**
 * EPUB 兼容性测试：
 * 1. 真实工具样本：scripts/epub-fixtures/generate.sh 用 epub4j / pandoc / ebooklib / epub-gen-memory / Calibre
 *    生成的 backend/tests/fixtures/epub-tools/*.epub，正文来自 scripts/epub-fixtures/book.json
 * 2. 人工边界用例：各种制作工具实际会出现、但写法不常见的 EPUB 结构
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-compat-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const FIXTURES = path.join(__dirname, '../fixtures/epub-tools');
const BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/epub-fixtures/book.json'), 'utf8')) as {
  title: string; author: string; chapters: Array<{ title: string; marker: string }>;
};

async function open(file: string): Promise<EpubParser> {
  const parser = new EpubParser();
  await parser.load(file);
  return parser;
}

/** 章节标题里按顺序找到书的 3 个章名，返回它们的章节下标 */
async function chapterIndexes(parser: EpubParser): Promise<number[]> {
  const titles = (await parser.getChapters()).map(c => c.title);
  const idx: number[] = [];
  for (const ch of BOOK.chapters) {
    const at = titles.findIndex((t, i) => i > (idx[idx.length - 1] ?? -1) && t.includes(ch.title));
    idx.push(at);
  }
  return idx;
}

describe('真实工具生成的 EPUB 样本', () => {
  const files = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter(f => f.endsWith('.epub')).sort() : [];

  it('样本齐全（epub4j / pandoc / ebooklib / epub-gen-memory / Calibre）', () => {
    expect(files).toEqual(expect.arrayContaining([
      'calibre.epub', 'ebooklib.epub', 'epub4j.epub', 'epubgen.epub', 'pandoc-epub2.epub', 'pandoc-epub3.epub',
    ]));
  });

  if (files.length) describe.each(files)('%s', file => {
    const full = path.join(FIXTURES, file);

    it('通过健康检查', async () => {
      expect(await checkEpubHealth(full)).toMatchObject({ status: expect.stringMatching(/^(ok|repaired)$/) });
    });

    it('目录按顺序列出 3 章，每章正文正确', async () => {
      const parser = await open(full);
      const idx = await chapterIndexes(parser);
      expect(idx.every(i => i >= 0)).toBe(true);
      for (let k = 0; k < BOOK.chapters.length; k++) {
        // 按应用取纯文本的方式比较（有的工具把中文全写成 &#x…; 数字实体，网页渲染时才还原）
        expect(chapterParagraphs(await parser.getChapterContent(idx[k])).join('\n')).toContain(BOOK.chapters[k].marker);
      }
    });

    it('读出书名、作者和封面', async () => {
      const parser = await open(full);
      expect(await parser.getMetadata()).toMatchObject({ title: BOOK.title, author: BOOK.author });
      expect(await parser.getCoverImage()).not.toBeNull();
    });
  });
});

// ── 人工边界用例 ──────────────────────────────────────────────

const CONTAINER = (opfPath: string) =>
  '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
  + `<rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
const XHTML = (title: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>`
  + `<body><h1>${title}</h1><p>${body}</p></body></html>`;
const NCX = (points: Array<[string, string]>) =>
  '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>'
  + points.map(([label, src], i) => `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${label}</text></navLabel><content src="${src}"/></navPoint>`).join('')
  + '</navMap></ncx>';
const OPF = (opts: { manifest: string; spine: string; toc?: boolean; version?: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?><package version="${opts.version ?? '2.0'}" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">`
  + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>边界书</dc:title><dc:creator>某人</dc:creator><dc:language>zh</dc:language></metadata>'
  + `<manifest>${opts.manifest}</manifest><spine${opts.toc === false ? '' : ' toc="ncx"'}>${opts.spine}</spine></package>`;

interface Entry { name: string; data: Buffer | string; store?: boolean }
function build(name: string, entries: Entry[], opts: { mimetype?: 'store' | 'deflate' | 'none' } = {}): string {
  const zip = new AdmZip();
  const mode = opts.mimetype ?? 'store';
  if (mode !== 'none') {
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    if (mode === 'store') zip.getEntry('mimetype')!.header.method = 0;
  }
  for (const e of entries) zip.addFile(e.name, Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data));
  const file = path.join(dir, name);
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

/** 两章的标准书，各用例在此基础上改一处 */
function twoChapters(o: {
  opfPath?: string; containerPath?: string; hrefs?: [string, string]; zipNames?: [string, string];
  ncxSrcs?: [string, string]; extraManifest?: string; extraSpine?: string;
} = {}): Entry[] {
  const opfPath = o.opfPath ?? 'OEBPS/content.opf';
  const base = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath) + '/';
  const hrefs = o.hrefs ?? ['c1.xhtml', 'c2.xhtml'];
  const zipNames = o.zipNames ?? hrefs.map(h => base + h) as [string, string];
  return [
    { name: 'META-INF/container.xml', data: CONTAINER(o.containerPath ?? opfPath) },
    { name: opfPath, data: OPF({
      manifest: `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
        + `<item id="c1" href="${hrefs[0]}" media-type="application/xhtml+xml"/><item id="c2" href="${hrefs[1]}" media-type="application/xhtml+xml"/>`
        + (o.extraManifest ?? ''),
      spine: '<itemref idref="c1"/>' + (o.extraSpine ?? '') + '<itemref idref="c2"/>',
    }) },
    { name: base + 'toc.ncx', data: NCX([['第一章', (o.ncxSrcs ?? hrefs)[0]], ['第二章', (o.ncxSrcs ?? hrefs)[1]]]) },
    { name: zipNames[0], data: XHTML('第一章', '甲章正文') },
    { name: zipNames[1], data: XHTML('第二章', '乙章正文') },
  ];
}

async function expectTwoChapters(file: string): Promise<void> {
  expect(await checkEpubHealth(file)).toEqual({ status: 'ok' });
  const parser = await open(file);
  expect((await parser.getChapters()).map(c => c.title)).toEqual(['第一章', '第二章']);
  expect(await parser.getChapterContent(0)).toContain('甲章正文');
  expect(await parser.getChapterContent(1)).toContain('乙章正文');
}

describe('人工边界用例', () => {
  it('基准：标准 EPUB2', async () => {
    await expectTwoChapters(build('base.epub', twoChapters()));
  });

  it('EPUB3 只有 nav、没有 NCX：章节标题取自 nav', async () => {
    const nav = '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body>'
      + '<nav epub:type="toc"><ol><li><a href="c1.xhtml">第一章</a></li><li><a href="c2.xhtml">第二章</a></li></ol></nav></body></html>';
    const file = build('nav-only.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER('OEBPS/content.opf') },
      { name: 'OEBPS/content.opf', data: OPF({
        version: '3.0', toc: false,
        manifest: '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
          + '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>',
        spine: '<itemref idref="c1"/><itemref idref="c2"/>',
      }) },
      { name: 'OEBPS/nav.xhtml', data: nav },
      { name: 'OEBPS/c1.xhtml', data: XHTML('第一章', '甲章正文') },
      { name: 'OEBPS/c2.xhtml', data: XHTML('第二章', '乙章正文') },
    ]);
    await expectTwoChapters(file);
  });

  it('manifest 和 spine 都只有 1 个条目', async () => {
    const file = build('single-item.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER('OEBPS/content.opf') },
      { name: 'OEBPS/content.opf', data: OPF({
        toc: false,
        manifest: '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>',
        spine: '<itemref idref="c1"/>',
      }) },
      { name: 'OEBPS/c1.xhtml', data: XHTML('第一章', '甲章正文') },
    ]);
    expect(await checkEpubHealth(file)).toEqual({ status: 'ok' });
    const parser = await open(file);
    expect(await parser.getChapters()).toHaveLength(1);
    expect(await parser.getChapterContent(0)).toContain('甲章正文');
  });

  it('中文文件名，href 经 URL 编码', async () => {
    const enc: [string, string] = [encodeURIComponent('第1章.xhtml'), encodeURIComponent('第2章.xhtml')];
    await expectTwoChapters(build('url-encoded.epub', twoChapters({ hrefs: enc, zipNames: ['OEBPS/第1章.xhtml', 'OEBPS/第2章.xhtml'] })));
  });

  it('文件名含空格，href 写成 %20', async () => {
    await expectTwoChapters(build('space.epub', twoChapters({
      hrefs: ['chapter%201.xhtml', 'chapter%202.xhtml'], zipNames: ['OEBPS/chapter 1.xhtml', 'OEBPS/chapter 2.xhtml'],
    })));
  });

  it('manifest href 与 zip 条目名大小写不一致', async () => {
    await expectTwoChapters(build('case.epub', twoChapters({
      hrefs: ['Text/Chapter1.xhtml', 'Text/Chapter2.xhtml'], zipNames: ['OEBPS/text/chapter1.xhtml', 'OEBPS/text/chapter2.xhtml'],
    })));
  });

  it('zip 条目用反斜杠分隔路径（Windows 工具打包）', async () => {
    const entries = twoChapters().map(e => ({ ...e, name: e.name.replace(/\//g, '\\') }));
    await expectTwoChapters(build('backslash.epub', entries));
  });

  it('mimetype 被压缩', async () => {
    await expectTwoChapters(build('mimetype-deflated.epub', twoChapters(), { mimetype: 'deflate' }));
  });

  it('没有 mimetype', async () => {
    await expectTwoChapters(build('no-mimetype.epub', twoChapters(), { mimetype: 'none' }));
  });

  it('spine 引用了 manifest 里没有的 id：跳过这一条', async () => {
    await expectTwoChapters(build('dangling-idref.epub', twoChapters({ extraSpine: '<itemref idref="missing"/>' })));
  });

  it('manifest 里有重复的 id', async () => {
    await expectTwoChapters(build('dup-id.epub', twoChapters({ extraManifest: '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' })));
  });

  it('content.opf 在 zip 根目录', async () => {
    await expectTwoChapters(build('opf-root.epub', twoChapters({ opfPath: 'content.opf' })));
  });

  it('container.xml 里的路径带 ./ 前缀', async () => {
    await expectTwoChapters(build('dot-slash.epub', twoChapters({ containerPath: './OEBPS/content.opf' })));
  });

  it('目录指向同一文件的不同锚点：按文件合并为一章（现状）', async () => {
    const file = build('anchors.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER('OEBPS/content.opf') },
      { name: 'OEBPS/content.opf', data: OPF({
        manifest: '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="all" href="all.xhtml" media-type="application/xhtml+xml"/>',
        spine: '<itemref idref="all"/>',
      }) },
      { name: 'OEBPS/toc.ncx', data: NCX([['第一章', 'all.xhtml#c1'], ['第二章', 'all.xhtml#c2']]) },
      { name: 'OEBPS/all.xhtml', data: XHTML('全书', '<a id="c1"/>甲章正文<a id="c2"/>乙章正文') },
    ]);
    const parser = await open(file);
    const chapters = await parser.getChapters();
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('第一章');
    expect(await parser.getChapterContent(0)).toContain('乙章正文');
  });

  it('XHTML 用 GBK 编码并在 XML 声明里写明', async () => {
    const gbk = (title: string, body: string) => iconv.encode(XHTML(title, body).replace('encoding="UTF-8"', 'encoding="GBK"'), 'gbk');
    const entries = twoChapters();
    entries[3] = { name: entries[3].name, data: gbk('第一章', '甲章正文') };
    entries[4] = { name: entries[4].name, data: gbk('第二章', '乙章正文') };
    await expectTwoChapters(build('gbk-xhtml.epub', entries));
  });
});

describe('extractNavToc', () => {
  it('只取 toc 导航，按 <ol> 嵌套给层级，href 解析为 zip 内路径并保留锚点', async () => {
    const { extractNavToc } = await import('../../src/plugins/parser-epub');
    const html = '<nav epub:type="landmarks"><ol><li><a href="cover.xhtml">封面</a></li></ol></nav>'
      + '<nav epub:type="toc"><ol><li><a href="Text/v1.xhtml">第一卷</a><ol>'
      + '<li><a href="Text/c1.xhtml#s1"><span>第一章</span></a></li><li><a href="Text/c2.xhtml">第二章</a></li></ol></li>'
      + '<li><a href="https://example.com/">外链</a></li></ol></nav>';
    expect(extractNavToc(html, 'OEBPS/nav.xhtml')).toEqual([
      { title: '第一卷', href: 'OEBPS/Text/v1.xhtml', level: 0 },
      { title: '第一章', href: 'OEBPS/Text/c1.xhtml#s1', level: 1 },
      { title: '第二章', href: 'OEBPS/Text/c2.xhtml', level: 1 },
    ]);
  });
});

describe('AI 填充取正文节选', () => {
  it('正文写成数字实体的书（epub-gen-memory）节选是正常文字', async () => {
    const { buildBookEvidence } = await import('../../src/services/book-evidence');
    const ev = await buildBookEvidence({ id: 'x', title: 'x', file_path: path.join(FIXTURES, 'epubgen.epub'), file_format: 'epub' });
    expect(ev.excerpt).toContain(BOOK.chapters[0].marker);
    expect(ev.excerpt).not.toMatch(/&#x?[0-9a-f]+;/i);
  });
});
