import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';
import { buildEpub, writeEpub, EpubInput } from '../../src/services/epub-builder';
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
