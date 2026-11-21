import fs from 'fs';
import os from 'os';
import path from 'path';
import AdmZip from 'adm-zip';
import { JSDOM } from 'jsdom';
import { buildEpub, EpubInput } from '../../src/services/epub-builder';
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
  it('第一项是未压缩的 mimetype', () => {
    const zip = new AdmZip(buildEpub(input()));
    const first = zip.getEntries()[0];
    expect(first.entryName).toBe('mimetype');
    expect(first.getData().toString()).toBe('application/epub+zip');
    expect(first.header.method).toBe(0);
  });

  it('分组标题在 nav 和 ncx 里作为上一级，组内章节嵌套', () => {
    const zip = new AdmZip(buildEpub(input()));
    const nav = parseXml(zip.readAsText('OEBPS/nav.xhtml'), 'application/xhtml+xml');
    const groupLi = Array.from(nav.querySelectorAll('nav li')).find(li => li.firstElementChild?.textContent === '第一部')!;
    expect(groupLi).toBeTruthy();
    expect(Array.from(groupLi.querySelectorAll('li a')).map(a => a.textContent)).toEqual(['第一回 灵根孕育', '第二回 悟彻菩提']);

    const ncx = parseXml(zip.readAsText('OEBPS/toc.ncx'));
    const group = Array.from(ncx.getElementsByTagName('navPoint')).find(n => n.getElementsByTagName('text')[0].textContent === '第一部')!;
    expect(group.getElementsByTagName('navPoint').length).toBe(2);
  });

  it('书名带 & < 、正文带 &nbsp; 时所有 XML 文件仍然合法', () => {
    const zip = new AdmZip(buildEpub(input({ title: 'A&B<x>', author: 'O"Neil' })));
    const opf = parseXml(zip.readAsText('OEBPS/content.opf'));
    expect(opf.getElementsByTagName('dc:title')[0].textContent).toBe('A&B<x>');
    for (const e of zip.getEntries().filter(e => e.entryName.endsWith('.xhtml'))) {
      parseXml(e.getData().toString('utf8'), 'application/xhtml+xml');
    }
  });

  it('项目自己的 EPUB 解析器能打开，章节和正文对得上', async () => {
    const file = path.join(TMP, 'out.epub');
    fs.writeFileSync(file, buildEpub(input()));
    const parser = new EpubParser();
    await parser.load(file);
    const chapters = await parser.getChapters();
    expect(chapters.map(c => c.title)).toEqual(['序', '第一回 灵根孕育', '第二回 悟彻菩提']);
    expect(await parser.getChapterContent(1)).toContain('傲来国');
  });

  it('正文开头已有标题行时不重复，标题行变成章节标题', () => {
    const zip = new AdmZip(buildEpub(input({ chapters: [
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

  it('有封面时写入封面并标记 cover-image', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const zip = new AdmZip(buildEpub(input({ cover: { data: png, mimeType: 'image/png' } })));
    expect(zip.readAsText('OEBPS/content.opf')).toMatch(/properties="cover-image"/);
    expect(zip.getEntry('OEBPS/cover.png')?.getData().equals(png)).toBe(true);
  });
});
