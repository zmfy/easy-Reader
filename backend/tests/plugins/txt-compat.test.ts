import fs from 'fs';
import os from 'os';
import path from 'path';
import iconv from 'iconv-lite';
import { detectAndFixEncoding } from '../../src/utils/encoding';
import { TxtParser } from '../../src/plugins/parser-txt';
import { chapterParagraphs } from '../../src/services/ai-reading';

/**
 * TXT 兼容性测试：各种编码 / 换行 / 章节标题写法 / 工具导出格式，走「扫描时编码检测与改写」→「阅读时解析」的完整流程。
 * 扫描时 detectAndFixEncoding 会把非 UTF-8 的原文件改写成 UTF-8：每个用例都比对改写后的内容，确认没有丢字。
 * 工具样本：scripts/txt-fixtures/generate.sh 生成的 backend/tests/fixtures/txt-tools/*.txt
 */

const BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/epub-fixtures/book.json'), 'utf8')) as {
  title: string; author: string; description: string;
  chapters: Array<{ title: string; marker: string; paragraphs: string[] }>;
};
const FIXTURES = path.join(__dirname, '../fixtures/txt-tools');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-compat-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

type Chapter = { title: string; marker: string; paragraphs: string[] };

/** 「标题\n\n　　正文」（so-novel 等网文工具的常见格式） */
function bookText(chapters: Chapter[] = BOOK.chapters, title = (c: Chapter) => c.title): string {
  return chapters.map(c => `${title(c)}\n\n${c.paragraphs.map(p => `　　${p}`).join('\n')}\n`).join('\n');
}

function write(name: string, data: Buffer | string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

/** 扫描（编码检测 + 改写）后再用阅读器打开，返回章节标题和每章纯文本 */
async function scanAndRead(file: string): Promise<{ status: string; encoding: string; titles: string[]; texts: string[] }> {
  const enc = await detectAndFixEncoding(file);
  const parser = new TxtParser();
  await parser.load(file);
  const chapters = await parser.getChapters();
  const texts: string[] = [];
  for (const c of chapters) texts.push(chapterParagraphs(await parser.getChapterContent(c.index)).join('\n'));
  return { status: enc.status, encoding: enc.encoding, titles: chapters.map(c => c.title), texts };
}

/** 3 章按顺序出现，每章正文含该章标记（chapters 默认为 book.json 的 3 章） */
function expectChapters(r: { titles: string[]; texts: string[] }, chapters: Chapter[] = BOOK.chapters): void {
  let last = -1;
  for (const ch of chapters) {
    const at = r.titles.findIndex((t, i) => i > last && t.includes(ch.title));
    expect({ title: ch.title, found: at > last }).toEqual({ title: ch.title, found: true });
    expect(r.texts[at]).toContain(ch.marker);
    last = at;
  }
}

/** 改写后文件按 UTF-8 读出（去掉 BOM），与原文一致 */
function expectFileText(file: string, text: string): void {
  expect(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')).toBe(text);
}

// 繁体样本（Big5 只能编码繁体字）
const TRAD: Chapter[] = [
  { title: '第一章 雨夜來客', marker: '【樣本標記-壹】', paragraphs: ['【樣本標記-壹】那天夜裡雨下得很大，院門外傳來三下敲門聲。', '老周披上外衣去開門。'] },
  { title: '第二章 河邊舊屋', marker: '【樣本標記-貳】', paragraphs: ['【樣本標記-貳】第二天雨停了，河水漲到了石階的第三級。', '年輕人打開木箱。'] },
  { title: '第三章 燈下長談', marker: '【樣本標記-參】', paragraphs: ['【樣本標記-參】晚飯後兩人在燈下坐著，從書說到鎮子。', '第三天清早，老周送他到渡口。'] },
];

// GB18030 才有的四字节字（GBK 编不了）
const RARE: Chapter[] = BOOK.chapters.map((c, i) => i === 0
  ? { ...c, paragraphs: [...c.paragraphs, '店名叫𠮷野家，门口石碑上刻着一个㐀字。'] }
  : c);

describe('编码', () => {
  it('UTF-8', async () => {
    const text = bookText();
    const file = write('utf8.txt', text);
    const r = await scanAndRead(file);
    expect(r.status).toBe('normal');
    expectFileText(file, text);
    expectChapters(r);
  });

  it('UTF-8 带 BOM', async () => {
    const text = bookText();
    const file = write('utf8-bom.txt', '﻿' + text);
    expectChapters(await scanAndRead(file));
    expectFileText(file, text);
  });

  it('GBK：改写为 UTF-8，内容不变', async () => {
    const text = bookText();
    const file = write('gbk.txt', iconv.encode(text, 'gbk'));
    const r = await scanAndRead(file);
    expect(r.status).toBe('encoding_fixed');
    expectFileText(file, text);
    expectChapters(r);
  });

  it('GB18030 含四字节生僻字：改写后一个字不丢', async () => {
    const text = bookText(RARE);
    const file = write('gb18030.txt', iconv.encode(text, 'gb18030'));
    const r = await scanAndRead(file);
    expect(r.status).toBe('encoding_fixed');
    expectFileText(file, text);
    expectChapters(r);
  });

  it('Big5 繁体：改写后内容不变（不能被当成 GBK）', async () => {
    const text = bookText(TRAD);
    const file = write('big5.txt', iconv.encode(text, 'big5'));
    const r = await scanAndRead(file);
    expect(r.status).toBe('encoding_fixed');
    expectFileText(file, text);
    expectChapters(r, TRAD);
  });

  it.each([['utf-16le', [0xff, 0xfe]], ['utf-16be', [0xfe, 0xff]]] as const)('%s 带 BOM', async (enc, bom) => {
    const text = bookText();
    const file = write(`${enc}-bom.txt`, Buffer.concat([Buffer.from(bom), iconv.encode(text, enc)]));
    const r = await scanAndRead(file);
    expect(r.status).toBe('encoding_fixed');
    expectFileText(file, text);
    expectChapters(r);
  });

  it('UTF-16LE 没有 BOM', async () => {
    const text = bookText();
    const file = write('utf16le-nobom.txt', iconv.encode(text, 'utf-16le'));
    const r = await scanAndRead(file);
    expectFileText(file, text);
    expectChapters(r);
  });

  it('开头 64KB 以上都是英文（版权声明等），后面才是 GBK 正文', async () => {
    const preamble = 'This file is distributed for personal reading only. All rights belong to the author.\n'.repeat(900);
    const text = preamble + bookText();
    const file = write('ascii-head-gbk.txt', iconv.encode(text, 'gbk'));
    const r = await scanAndRead(file);
    expectFileText(file, text);
    expectChapters(r);
  });

  it('UTF-8 不被误改写：英文为主、只夹几个中文字、超过 64KB', async () => {
    const text = 'An English novel with a few Chinese words such as 你好 and 再见 here.\n'.repeat(3000);
    const file = write('utf8-mostly-ascii.txt', text);
    const before = fs.readFileSync(file);
    expect((await detectAndFixEncoding(file)).status).toBe('normal');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('UTF-8 不被误改写：本身含少量替换符（U+FFFD）', async () => {
    const text = bookText().replace('雨下得很大', '雨下得�大').repeat(40);
    const file = write('utf8-with-fffd.txt', text);
    const before = fs.readFileSync(file);
    expect((await detectAndFixEncoding(file)).status).toBe('normal');
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it('很短的 GBK 文件', async () => {
    const short: Chapter[] = [{ title: '第一章 短篇', marker: '【短】', paragraphs: ['【短】只有一句话的小故事。'] }];
    const text = bookText(short);
    const file = write('gbk-short.txt', iconv.encode(text, 'gbk'));
    const r = await scanAndRead(file);
    expectFileText(file, text);
    expectChapters(r, short);
  });
});

describe('换行', () => {
  it('CRLF', async () => {
    expectChapters(await scanAndRead(write('crlf.txt', bookText().replace(/\n/g, '\r\n'))));
  });

  it('只有 CR（老 Mac）', async () => {
    expectChapters(await scanAndRead(write('cr.txt', bookText().replace(/\n/g, '\r'))));
  });
});

describe('章节标题写法', () => {
  const variants: Array<[string, (c: Chapter, i: number) => string]> = [
    ['全角数字「第１章」', (c, i) => c.title.replace(/^第[一二三]章/, `第${String.fromCharCode(0xff11 + i)}章`)],
    ['「正文 第一章 …」', c => `正文 ${c.title}`],
    ['「【第一章】…」', c => c.title.replace(/^(第.章) /, '【$1】')],
    ['「第一章：…」', c => c.title.replace(' ', '：')],
  ];
  it.each(variants)('%s', async (_name, make) => {
    const chapters = BOOK.chapters.map((c, i) => ({ ...c, title: make(c, i) }));
    expectChapters(await scanAndRead(write(`heading-${_name}.txt`, bookText(chapters))), chapters);
  });

  it('英文「Chapter 1」', async () => {
    const chapters = BOOK.chapters.map((c, i) => ({ ...c, title: `Chapter ${i + 1} ${['Rain', 'River', 'Lamp'][i]}` }));
    expectChapters(await scanAndRead(write('heading-english.txt', bookText(chapters))), chapters);
  });

  it('楔子 / 番外 各自成章', async () => {
    const chapters: Chapter[] = [
      { title: '楔子', marker: '【楔子标记】', paragraphs: ['【楔子标记】很多年以后，老周还记得那个雨夜。'] },
      ...BOOK.chapters,
      { title: '番外 渡口', marker: '【番外标记】', paragraphs: ['【番外标记】年轻人后来回过一次镇子。'] },
    ];
    expectChapters(await scanAndRead(write('heading-extra.txt', bookText(chapters))), chapters);
  });

  it('正文里以「后记得」「前言不搭后语」开头的句子不算标题', async () => {
    const chapters = BOOK.chapters.map((c, i) => i === 1
      ? { ...c, paragraphs: [...c.paragraphs, '后记得那天的雨声', '前言不搭后语地说了几句'] }
      : c);
    const r = await scanAndRead(write('heading-false-positive.txt', bookText(chapters).replace(/　　(后记得|前言不搭)/g, '$1')));
    expect(r.titles).toEqual(BOOK.chapters.map(c => c.title));
  });

  it('整本没有章节标题：按段切分，正文完整', async () => {
    const text = BOOK.chapters.map(c => c.paragraphs.map(p => `　　${p}`).join('\n')).join('\n');
    const r = await scanAndRead(write('no-heading.txt', text));
    const all = r.texts.join('\n');
    for (const c of BOOK.chapters) expect(all).toContain(c.marker);
  });
});

describe('工具导出格式', () => {
  /** 照 so-novel TxtMergeHandler：开头书名 / 作者 / 简介，然后各章「标题\n\n　　正文」 */
  const soNovel = () => `书名：${BOOK.title}\n作者：${BOOK.author}\n简介：${BOOK.description}\n` + bookText();

  it('so-novel（UTF-8）：开头的书名 / 作者 / 简介不当章节', async () => {
    const r = await scanAndRead(write('so-novel-utf8.txt', soNovel()));
    expectChapters(r);
    expect(r.titles.filter(t => /书名|作者|简介/.test(t))).toEqual([]);
  });

  it('so-novel（配置为 GBK 输出）', async () => {
    const file = write('so-novel-gbk.txt', iconv.encode(soNovel(), 'gbk'));
    const r = await scanAndRead(file);
    expectFileText(file, soNovel());
    expectChapters(r);
  });

  const files = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter(f => f.endsWith('.txt')).sort() : [];
  it('真实工具样本齐全（Calibre / pandoc）', () => {
    expect(files).toEqual(expect.arrayContaining(['calibre.txt', 'pandoc.txt']));
  });
  if (files.length) {
    it.each(files)('%s', async file => {
      const copy = write(`tool-${file}`, fs.readFileSync(path.join(FIXTURES, file)));
      expectChapters(await scanAndRead(copy));
    });
  }
});
