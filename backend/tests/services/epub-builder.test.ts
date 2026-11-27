import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';
import { buildEpub, writeEpub, EpubInput, sanitizeXmlText } from '../../src/services/epub-builder';
import { EpubParser } from '../../src/plugins/parser-epub';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'epub-builder-'));

const input = (over: Partial<EpubInput> = {}): EpubInput => ({
  id: 'b1',
  title: '西游记',
  author: '吴承恩',
  summary: '取经的故事',
  chapters: [
    { title: '序', html: '<p>开篇&nbsp;第一段</p>' },
    { title: '第一回 灵根孕育', html: '<p>海外有一国土，名曰傲来国。</p>', groupTitle: '第一部' },
    { title: '第二回 悟彻菩提', html: '<p>话表美猴王。</p>', groupTitle: '第一部' },
  ],
  ...over,
});

function parseXml(text: string, type: 'application/xml' | 'application/xhtml+xml' = 'application/xml'): Document {
  const doc = new JSDOM(text, { contentType: type }).window.document;
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}

describe('buildEpub', () => {
  it('第一项是未压缩的 mimetype', async () => {
    const zip = new AdmZip(await buildEpub(input()));
    const first = zip.getEntries()[0];
    expect(first.entryName).toBe('mimetype');
    expect(first.getData().toString()).toBe('application/epub+zip');
    expect(first.header.method).toBe(0);
  });

  it('分组标题在 nav 和 ncx 里作为上一级，组内章节嵌套', async () => {
    const zip = new AdmZip(await buildEpub(input()));
    const nav = parseXml(zip.readAsText('OEBPS/nav.xhtml'), 'application/xhtml+xml');
    const groupLi = Array.from(nav.querySelectorAll('nav li')).find(li => li.firstElementChild?.textContent === '第一部')!;
    expect(groupLi).toBeTruthy();
    expect(Array.from(groupLi.querySelectorAll('li a')).map(a => a.textContent)).toEqual(['第一回 灵根孕育', '第二回 悟彻菩提']);

    const ncx = parseXml(zip.readAsText('OEBPS/toc.ncx'));
    const group = Array.from(ncx.getElementsByTagName('navPoint')).find(n => n.getElementsByTagName('text')[0].textContent === '第一部')!;
    expect(group.getElementsByTagName('navPoint').length).toBe(2);
  });

  it('书名带 & < 、正文带 &nbsp; 时所有 XML 文件仍然合法', async () => {
    const zip = new AdmZip(await buildEpub(input({ title: 'A&B<x>', author: 'O"Neil' })));
    const opf = parseXml(zip.readAsText('OEBPS/content.opf'));
    expect(opf.getElementsByTagName('dc:title')[0].textContent).toBe('A&B<x>');
    for (const e of zip.getEntries().filter(e => e.entryName.endsWith('.xhtml'))) {
      parseXml(e.getData().toString('utf8'), 'application/xhtml+xml');
    }
  });

  it('项目自己的 EPUB 解析器能打开，章节和正文对得上', async () => {
    const file = path.join(TMP, 'out.epub');
    fs.writeFileSync(file, await buildEpub(input()));
    const parser = new EpubParser();
    await parser.load(file);
    const chapters = await parser.getChapters();
    expect(chapters.map(c => c.title)).toEqual(['序', '第一回 灵根孕育', '第二回 悟彻菩提']);
    expect(await parser.getChapterContent(1)).toContain('傲来国');
  });

  it('正文开头已有标题行时不重复，标题行变成章节标题', async () => {
    const zip = new AdmZip(await buildEpub(input({ chapters: [
      { title: '第二回 悟彻菩提', html: '<p>第二回 悟彻菩提</p>\n<p>话表美猴王。</p>' },
      { title: '第三回', html: '<p>序言一段</p>\n<p>第三回</p>\n<p>正文</p>' },
      { title: '第四回', html: '<p>没有标题行</p>' },
    ] })));
    const c1 = zip.readAsText('OEBPS/text/c0001.xhtml');
    expect(c1.match(/第二回 悟彻菩提/g)).toHaveLength(2); // <title> 与 <h2> 各一次
    expect(c1).toContain('<h2>第二回 悟彻菩提</h2>');
    expect(c1).not.toContain('<p>第二回 悟彻菩提</p>');
    const c2 = zip.readAsText('OEBPS/text/c0002.xhtml');
    expect(c2).toContain('<h2>第三回</h2>');
    expect(c2).not.toContain('<p>第三回</p>');
    expect(c2.indexOf('序言一段')).toBeGreaterThan(c2.indexOf('<h2>'));
    expect(zip.readAsText('OEBPS/text/c0003.xhtml')).toContain('<h2>第四回</h2>');
  });

  it('有封面时写入封面并标记 cover-image', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const zip = new AdmZip(await buildEpub(input({ cover: { data: png, mimeType: 'image/png' } })));
    expect(zip.readAsText('OEBPS/content.opf')).toMatch(/properties="cover-image"/);
    expect(zip.getEntry('OEBPS/cover.png')?.getData().equals(png)).toBe(true);
  });
});

describe('章节标题去重的特殊情况', () => {
  it('标题带引号（正文里引号未转义）时也不重复', async () => {
    const zip = new AdmZip(await buildEpub(input({ chapters: [{ title: '第一回 "猴王"出世', html: '<p>第一回 "猴王"出世</p>\n<p>正文</p>' }] })));
    const c1 = zip.readAsText('OEBPS/text/c0001.xhtml');
    expect(c1).not.toMatch(/<p>第一回/);
  });

  it('统一过标题的书：正文里保留的原始标题行也去掉', async () => {
    const out = path.join(TMP, 'normalized.epub');
    await writeEpub({
      id: 'n', title: '书',
      toc: [{ title: '第1回 灵根孕育', sourceTitle: '第一回　灵根孕育' }],
      chapterHtml: async () => '<p>第一回　灵根孕育</p>\n<p>正文</p>',
    }, out);
    const c1 = new AdmZip(out).readAsText('OEBPS/text/c0001.xhtml');
    expect(c1).toContain('<h2>第1回 灵根孕育</h2>');
    expect(c1).not.toContain('第一回');
  });
});

describe('keepTitleParagraph / sanitizeXmlText', () => {
  it('keepTitleParagraph：正文开头与标题相同的段落保留', async () => {
    const out = path.join(TMP, 'keep-title.epub');
    await writeEpub({
      id: 'k', title: '书', keepTitleParagraph: true,
      toc: [{ title: '第一章 开端' }],
      chapterHtml: async () => '<p>第一章 开端</p>\n<p>正文</p>',
    }, out);
    const c1 = new AdmZip(out).readAsText('OEBPS/text/c0001.xhtml');
    expect(c1).toContain('<h2>第一章 开端</h2>');
    expect(c1).toContain('<p>第一章 开端</p>');
  });

  it('sanitizeXmlText 去掉 XML 不允许的控制字符，保留 tab / 换行', () => {
    expect(sanitizeXmlText('a\u0001b\u000Bc\td\ne\rf\u001F')).toBe('abc\td\ne\rf');
  });
});

describe('writeEpub（逐章写出）', () => {
  let seed = 42;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
  // 伪随机汉字：难压缩，接近真实小说的压缩开销
  const hardText = (n: number) => Array.from({ length: n }, () => String.fromCharCode(0x4e00 + (rand() % 3000))).join('');

  it('上一章写进文件后才取下一章，整本书不会同时在内存里', async () => {
    const out = path.join(TMP, 'lazy.epub');
    const sizes: number[] = [];
    await writeEpub({
      id: 'b', title: '书',
      toc: Array.from({ length: 5 }, (_v, i) => ({ title: `第${i + 1}章` })),
      chapterHtml: async () => { sizes.push(fs.statSync(out).size); return `<p>${hardText(2000)}</p>`; },
    }, out);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
    expect(new AdmZip(out).getEntries().filter(e => e.entryName.startsWith('OEBPS/text/'))).toHaveLength(5);
  });

  it('写几千章难压缩的正文时事件循环不被长时间卡住', async () => {
    const out = path.join(TMP, 'big.epub');
    // 量的是两次定时器之间主线程自己用掉的 CPU 时间：代码卡住事件循环时它约等于间隔；
    // 只用墙钟间隔的话，全量测试并行、进程分不到 CPU 时也会有 1 秒多的间隔（期间 CPU 只有几毫秒），会误报。
    // process.threadCpuUsage 只算当前线程（Node 22.23 实测可用；@types/node 20 还没有声明），不含线程池里的压缩
    const threadCpu = (prev?: NodeJS.CpuUsage): NodeJS.CpuUsage =>
      (process as unknown as { threadCpuUsage(p?: NodeJS.CpuUsage): NodeJS.CpuUsage }).threadCpuUsage(prev);
    let last = threadCpu();
    let maxGap = 0;
    const timer = setInterval(() => {
      const d = threadCpu(last);
      maxGap = Math.max(maxGap, (d.user + d.system) / 1000);
      last = threadCpu();
    }, 5);
    await writeEpub({
      id: 'big', title: '大书',
      toc: Array.from({ length: 4000 }, (_v, i) => ({ title: `第${i + 1}章` })),
      chapterHtml: async () => `<p>${hardText(3000)}</p>`,
    }, out);
    clearInterval(timer);
    expect(maxGap).toBeLessThan(200);
    expect(new AdmZip(out).getEntries().length).toBe(4000 + 6);
  }, 60000);

  it('取正文出错时删除半成品文件', async () => {
    const out = path.join(TMP, 'fail.epub');
    await expect(writeEpub({
      id: 'f', title: '书', toc: [{ title: '一' }, { title: '二' }],
      chapterHtml: async i => { if (i === 1) throw new Error('读不出'); return '<p>x</p>'; },
    }, out)).rejects.toThrow('读不出');
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('三层目录（level）', () => {
  // 部、卷是只有标题的普通条目（各有一个文件），按 level 嵌套
  const threeLevel = () => ({
    id: 'o1', title: '三层书',
    toc: [
      { title: '序', level: 0 },
      { title: '第一部', level: 0 },
      { title: '第一卷', level: 1 },
      { title: '第一章', level: 2 },
      { title: '第二章', level: 2 },
      { title: '第二卷', level: 1 },
      { title: '第三章', level: 2 },
    ],
    chapterHtml: async (i: number) => `<p>正文${i}</p>`,
  });

  it('三层目录：nav.xhtml 嵌套两层 ol，toc.ncx navPoint 嵌套，playOrder 连续', async () => {
    const out = path.join(TMP, 'three.epub');
    await writeEpub(threeLevel(), out);
    const zip = new AdmZip(out);

    const nav = parseXml(zip.readAsText('OEBPS/nav.xhtml'), 'application/xhtml+xml');
    const kids = (el: Element) => Array.from(el.children).filter(c => c.tagName === 'ol').flatMap(ol => Array.from(ol.children));
    const label = (li: Element) => li.firstElementChild!.textContent;
    const top = kids(nav.querySelector('nav')!);
    expect(top.map(label)).toEqual(['序', '第一部']);
    const volumes = kids(top[1]);
    expect(volumes.map(label)).toEqual(['第一卷', '第二卷']);
    expect(kids(volumes[0]).map(label)).toEqual(['第一章', '第二章']);
    expect(kids(volumes[1]).map(label)).toEqual(['第三章']);
    expect(volumes[0].firstElementChild!.getAttribute('href')).toBe('text/c0003.xhtml');

    const ncx = parseXml(zip.readAsText('OEBPS/toc.ncx'));
    const points = Array.from(ncx.getElementsByTagName('navPoint'));
    expect(points.map(p => p.getAttribute('playOrder'))).toEqual(points.map((_p, i) => String(i + 1)));
    expect(points.map(p => p.getElementsByTagName('text')[0].textContent))
      .toEqual(['序', '第一部', '第一卷', '第一章', '第二章', '第二卷', '第三章']);
    const depth = (p: Element) => { let d = 0; for (let e = p.parentElement; e && e.tagName === 'navPoint'; e = e.parentElement) d++; return d; };
    expect(points.map(depth)).toEqual([0, 0, 1, 2, 2, 1, 2]);
    expect(zip.readAsText('OEBPS/content.opf').match(/<itemref /g)).toHaveLength(7);
  });

  it('用项目自己的 EPUB 解析器读回：章节顺序对应 spine 顺序，层级正确', async () => {
    const out = path.join(TMP, 'three-read.epub');
    const called: number[] = [];
    await writeEpub({ ...threeLevel(), chapterHtml: async i => { called.push(i); return `<p>正文${i}</p>`; } }, out);
    expect(called).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const parser = new EpubParser();
    await parser.load(out);
    const chapters = await parser.getChapters();
    expect(chapters.map(c => c.title)).toEqual(['序', '第一部', '第一卷', '第一章', '第二章', '第二卷', '第三章']);
    expect(chapters.map(c => c.level ?? 0)).toEqual([0, 0, 1, 2, 2, 1, 2]);
    expect(chapters.map(c => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(await parser.getChapterContent(3)).toContain('正文3');
    expect(await parser.getChapterContent(6)).toContain('正文6');
  });

  it('不带 level 时输出与修改前一致', async () => {
    const zip = new AdmZip(await buildEpub({ id: 'b1', title: '书', chapters: [
      { title: '序', html: '<p>a</p>' },
      { title: '一', html: '<p>b</p>', groupTitle: '第一部' },
      { title: '二', html: '<p>c</p>', groupTitle: '第一部' },
    ] }));
    expect(zip.readAsText('OEBPS/nav.xhtml')).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh" lang="zh">
<head><meta charset="UTF-8"/><title>目录</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>目录</h1>
<ol>
<li><a href="text/c0001.xhtml">序</a></li>
<li><span>第一部</span>
<ol>
<li><a href="text/c0002.xhtml">一</a></li>
<li><a href="text/c0003.xhtml">二</a></li>
</ol></li>
</ol>
</nav>
</body>
</html>`);
    expect(zip.readAsText('OEBPS/toc.ncx')).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh">
<head><meta name="dtb:uid" content="urn:easyreader:b1"/></head>
<docTitle><text>书</text></docTitle>
<navMap>
<navPoint id="np1" playOrder="1"><navLabel><text>序</text></navLabel><content src="text/c0001.xhtml"/></navPoint>
<navPoint id="np2" playOrder="2"><navLabel><text>第一部</text></navLabel><content src="text/c0002.xhtml"/>
<navPoint id="np3" playOrder="3"><navLabel><text>一</text></navLabel><content src="text/c0002.xhtml"/></navPoint>
<navPoint id="np4" playOrder="4"><navLabel><text>二</text></navLabel><content src="text/c0003.xhtml"/></navPoint>
</navPoint>
</navMap>
</ncx>`);
    const opf = zip.readAsText('OEBPS/content.opf');
    expect(opf).toContain('<spine toc="ncx">\n<itemref idref="c1"/>\n<itemref idref="c2"/>\n<itemref idref="c3"/>\n</spine>');
  });
});
