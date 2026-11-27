import fs from 'fs';
import os from 'os';
import path from 'path';
import { PdfParser } from '../../src/plugins/parser-pdf';
import { chapterParagraphs } from '../../src/services/ai-reading';
import { buildBookEvidence } from '../../src/services/book-evidence';

/**
 * PDF 兼容性测试：scripts/pdf-fixtures/generate.sh 用 reportlab / Chromium / Calibre / qpdf 生成的
 * backend/tests/fixtures/pdf-tools/*.pdf，正文来自 scripts/epub-fixtures/book.json（每章一页）。
 * 后端只负责取文字（PDF 文字模式、AI 问书 / 前情、听书、AI 填充）；页面显示由前端 pdf.js 渲染原文件。
 */

const FIXTURES = path.join(__dirname, '../fixtures/pdf-tools');
const BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/epub-fixtures/book.json'), 'utf8')) as {
  title: string; author: string; chapters: Array<{ title: string; marker: string }>;
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-compat-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const parsers: PdfParser[] = [];
afterEach(() => { parsers.splice(0).forEach(p => p.dispose()); });

async function open(file: string): Promise<PdfParser> {
  const parser = new PdfParser();
  parsers.push(parser);
  await parser.load(file);
  return parser;
}

async function pageTexts(parser: PdfParser): Promise<string[]> {
  const pages = await parser.getChapters();
  const out: string[] = [];
  for (const p of pages) out.push(chapterParagraphs(await parser.getChapterContent(p.index)).join('\n'));
  return out;
}

/** 有文字层的样本，以及工具会写进文档属性的字段 */
const TEXT_SAMPLES: Array<[string, { title?: boolean; author?: boolean }]> = [
  ['reportlab-cid.pdf', { title: true, author: true }],
  ['reportlab-ttf.pdf', { title: true, author: true }],
  ['qpdf-owner.pdf', { title: true, author: true }],
  ['chrome.pdf', {}],
  ['calibre.pdf', { title: true, author: true }],
];

describe('有文字层的 PDF 样本', () => {
  it('样本齐全', () => {
    const files = fs.readdirSync(FIXTURES).filter(f => f.endsWith('.pdf'));
    expect(files).toEqual(expect.arrayContaining([...TEXT_SAMPLES.map(s => s[0]), 'qpdf-user.pdf', 'scanned.pdf']));
  });

  describe.each(TEXT_SAMPLES)('%s', (file, meta) => {
    const full = path.join(FIXTURES, file);

    it('按页取出正文，3 章的标记按顺序出现在不同页', async () => {
      const texts = await pageTexts(await open(full));
      let last = -1;
      for (const ch of BOOK.chapters) {
        const at = texts.findIndex((t, i) => i > last && t.includes(ch.marker));
        expect({ marker: ch.marker, page: at }).toEqual({ marker: ch.marker, page: expect.any(Number) });
        expect(at).toBeGreaterThan(last);
        last = at;
      }
    });

    it('读出文档属性里的书名 / 作者', async () => {
      const m = await (await open(full)).getMetadata();
      if (meta.title) expect(m.title).toBe(BOOK.title);
      if (meta.author) expect(m.author).toBe(BOOK.author);
    });

    it('AI 填充的正文节选含第一章正文', async () => {
      const ev = await buildBookEvidence({ id: 'x', title: 'x', file_path: full, file_format: 'pdf' });
      expect(ev.excerpt).toContain(BOOK.chapters[0].marker);
    });
  });
});

describe('打不开 / 没有文字的 PDF', () => {
  it('需要打开密码：load 报错', async () => {
    await expect(open(path.join(FIXTURES, 'qpdf-user.pdf'))).rejects.toThrow();
  });

  it('文件被截断：load 报错', async () => {
    const buf = fs.readFileSync(path.join(FIXTURES, 'reportlab-ttf.pdf'));
    const file = path.join(dir, 'truncated.pdf');
    fs.writeFileSync(file, buf.subarray(0, Math.floor(buf.length / 2)));
    await expect(open(file)).rejects.toThrow();
  });

  it('扫描版：能打开、3 页，取不出文字', async () => {
    const parser = await open(path.join(FIXTURES, 'scanned.pdf'));
    expect(await parser.getChapters()).toHaveLength(3);
    expect((await pageTexts(parser)).join('')).toBe('');
  });

  it('扫描版：AI 填充说明无法读取正文', async () => {
    const ev = await buildBookEvidence({ id: 'x', title: 'x', file_path: path.join(FIXTURES, 'scanned.pdf'), file_format: 'pdf' });
    expect(ev.excerpt).toBe('');
    expect(ev.text).toContain('无法读取正文');
  });
});
