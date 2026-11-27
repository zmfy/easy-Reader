import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import { UmdParser, UmdFormatError, PLACEHOLDER_COVER_SHA1 } from '../../src/plugins/parser-umd';
import { checkBookHealth } from '../../src/services/book-health';

/**
 * UMD 兼容性测试。Linux 上没有 UMD 制作工具，样本由下面的 buildUmd 按格式规范生成；
 * 块的种类和顺序照着真实样本（飞库网等生成的 6 本书）排列：
 *   头部 #01〜#09、#0B → #83+$ 章节偏移 → #84+$ 章节标题 → 正文 $ 块（中间夹 #F1 / #0A）
 *   → #81+$ 正文块索引 → #82+$ 封面 → #87+$ 分页 → #0C 文件结束
 * 局限：生成器和解析器出自同一份规范理解，规范以外的写法只能靠真实样本发现。
 */

const BOOK = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../scripts/epub-fixtures/book.json'), 'utf8')) as {
  title: string; author: string;
  chapters: Array<{ title: string; marker: string; paragraphs: string[] }>;
};
const PARA = String.fromCharCode(0x2029);   // UMD 的段落分隔符
const BLOCK_BYTES = 0x8000;                  // 正文按 32KB 一块压缩

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'umd-compat-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

interface Chapter { title: string; body: string }

interface BuildOpts {
  chapters?: Chapter[];
  type?: number;
  /** false：不写 #83 章节偏移 */
  offsets?: boolean | number[];
  /** false：不写 #84 章节标题；数组：用这些标题 */
  titles?: boolean | string[];
  cover?: Buffer;
  /** 正文块之间插入零字节填充 */
  zeroPadding?: boolean;
  /** 第 4 字节（规范是 DE） */
  magic4?: number;
  /** 不写 #0C 文件结束 */
  noEnd?: boolean;
}

let rnd = 0x1000;
const nextRnd = () => rnd++;

function hashBlock(id: number, data: Buffer, flag = 0): Buffer {
  const head = Buffer.from([0x23, 0, 0, flag, 5 + data.length]);
  head.writeUInt16LE(id, 1);
  return Buffer.concat([head, data]);
}

function dollarBlock(data: Buffer, check = nextRnd()): Buffer {
  const head = Buffer.alloc(9);
  head[0] = 0x24;
  head.writeUInt32LE(check, 1);
  head.writeUInt32LE(9 + data.length, 5);
  return Buffer.concat([head, data]);
}

/** 后面跟一个 $ 数据块的 # 块（# 块数据以校验码结尾，$ 块用同一个校验码） */
function hashWithData(id: number, data: Buffer, prefix: Buffer = Buffer.alloc(0)): Buffer {
  const check = nextRnd();
  const c = Buffer.alloc(4);
  c.writeUInt32LE(check, 0);
  return Buffer.concat([hashBlock(id, Buffer.concat([prefix, c]), 1), dollarBlock(data, check)]);
}

const u16 = (s: string) => Buffer.from(s, 'utf16le');
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; };

function sampleChapters(): Chapter[] {
  return BOOK.chapters.map(c => ({ title: c.title, body: `${c.title}${PARA}${c.paragraphs.map(p => `　　${p}`).join(PARA)}${PARA}` }));
}

function buildUmd(opts: BuildOpts = {}): Buffer {
  const chapters = opts.chapters ?? sampleChapters();
  const text = u16(chapters.map(c => c.body).join(''));
  const offsets: number[] = [];
  let at = 0;
  for (const c of chapters) { offsets.push(at); at += u16(c.body).length; }

  const parts: Buffer[] = [Buffer.from([0x89, 0x9b, 0x9a, opts.magic4 ?? 0xde])];
  parts.push(hashBlock(0x01, Buffer.from([opts.type ?? 1, 0x12, 0x34]), 0));
  parts.push(hashBlock(0x02, u16(BOOK.title)));
  parts.push(hashBlock(0x03, u16(BOOK.author)));
  parts.push(hashBlock(0x04, u16('2008')));
  parts.push(hashBlock(0x05, u16('3')));
  parts.push(hashBlock(0x07, u16('小说')));
  parts.push(hashBlock(0x08, u16('测试出版社')));
  parts.push(hashBlock(0x0b, u32(text.length)));

  if (opts.offsets !== false) {
    const list = Array.isArray(opts.offsets) ? opts.offsets : offsets;
    parts.push(hashWithData(0x83, Buffer.concat(list.map(u32))));
  }
  if (opts.titles !== false) {
    const list = Array.isArray(opts.titles) ? opts.titles : chapters.map(c => c.title);
    parts.push(hashWithData(0x84, Buffer.concat(list.map(t => Buffer.concat([Buffer.from([u16(t).length]), u16(t)])))));
  }

  // 正文：每 32KB 压缩成一块，最后一块补零到 32KB（真实文件就是这样）；块之间按真实样本夹 #F1 / #0A
  const ids: number[] = [];
  for (let i = 0; i * BLOCK_BYTES < text.length; i++) {
    const raw = Buffer.alloc(BLOCK_BYTES);
    text.copy(raw, 0, i * BLOCK_BYTES, Math.min((i + 1) * BLOCK_BYTES, text.length));
    const id = nextRnd();
    ids.push(id);
    parts.push(dollarBlock(zlib.deflateSync(raw), id));
    if (i === 0) parts.push(hashBlock(0xf1, Buffer.alloc(16), 0), hashBlock(0x0a, u32(nextRnd()), 0));
    if (opts.zeroPadding) parts.push(Buffer.alloc(7));
  }

  parts.push(hashWithData(0x81, Buffer.concat(ids.map(u32))));
  if (opts.cover) parts.push(hashWithData(0x82, opts.cover, Buffer.from([0x01])));
  parts.push(hashWithData(0x87, Buffer.alloc(40, 0x11), Buffer.from([0x10, 0xd0])));
  if (!opts.noEnd) {
    const total = parts.reduce((n, p) => n + p.length, 0) + 9;
    parts.push(hashBlock(0x0c, u32(total), 1));
  }
  return Buffer.concat(parts);
}

let seq = 0;
function write(data: Buffer): string {
  const file = path.join(dir, `book-${seq++}.umd`);
  fs.writeFileSync(file, data);
  return file;
}

async function read(file: string): Promise<{ parser: UmdParser; titles: string[]; texts: string[] }> {
  const parser = new UmdParser();
  await parser.load(file);
  const chapters = await parser.getChapters();
  const texts: string[] = [];
  for (const c of chapters) texts.push(await parser.getChapterContent(c.index));
  return { parser, titles: chapters.map(c => c.title), texts };
}

/** 每章正文含该章标记，且不含下一章的标记 */
function expectSampleChapters(texts: string[]): void {
  expect(texts).toHaveLength(BOOK.chapters.length);
  BOOK.chapters.forEach((c, i) => {
    expect(texts[i]).toContain(c.marker);
    const next = BOOK.chapters[i + 1];
    if (next) expect(texts[i]).not.toContain(next.marker);
  });
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 0x42), Buffer.from([0xff, 0xd9])]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(100, 0x01)]);

async function loadError(file: string): Promise<UmdFormatError> {
  const err = await new UmdParser().load(file).then(() => null, e => e);
  expect(err).toBeInstanceOf(UmdFormatError);
  return err as UmdFormatError;
}

describe('UMD · 规范格式', () => {
  it('按章节偏移切章，标题、正文、书目信息都正确', async () => {
    const r = await read(write(buildUmd()));
    expect(r.titles).toEqual(BOOK.chapters.map(c => c.title));
    expectSampleChapters(r.texts);
    // 段落按 U+2029 分开
    expect(r.texts[0].split('</p>').length - 1).toBe(BOOK.chapters[0].paragraphs.length + 1);
    expect(await r.parser.getMetadata()).toMatchObject({ title: BOOK.title, author: BOOK.author, date: '2008-3', publisher: '测试出版社' });
  });

  it('正文超过 32KB（多个正文块），最后一块补的零不出现在正文里', async () => {
    const long = '　　长段落内容，用来把正文撑过好几个压缩块。'.repeat(40);
    const chapters = Array.from({ length: 30 }, (_, i) => ({ title: `第${i + 1}章`, body: `第${i + 1}章${PARA}【标记${i + 1}】${long}${PARA}` }));
    const r = await read(write(buildUmd({ chapters })));
    expect(r.titles).toHaveLength(30);
    r.texts.forEach((t, i) => expect(t).toContain(`【标记${i + 1}】`));
    expect(r.texts.join('')).not.toContain(String.fromCharCode(0));
    expect(r.texts[29].endsWith('</p>')).toBe(true);
  });

  it('正文里没有章节标题（真实样本《脂砚斋重评石头记》）：仍按偏移切出全部章节', async () => {
    const chapters = sampleChapters().map(c => ({ ...c, body: c.body.slice(c.title.length + 1) }));
    const r = await read(write(buildUmd({ chapters })));
    expect(r.titles).toEqual(BOOK.chapters.map(c => c.title));
    expectSampleChapters(r.texts);
  });

  it('正文里的标题和目录写法不同（真实样本《易中天品三国》）：章节不丢', async () => {
    const titles = BOOK.chapters.map((c, i) => (i === 1 ? `附：${c.title}（修订）` : c.title));
    const r = await read(write(buildUmd({ titles })));
    expect(r.titles).toEqual(titles);
    expectSampleChapters(r.texts);
  });

  it('标题比偏移少：缺的标题按「第 N 章」补', async () => {
    const r = await read(write(buildUmd({ titles: [BOOK.chapters[0].title] })));
    expect(r.titles).toEqual([BOOK.chapters[0].title, '第 2 章', '第 3 章']);
    expectSampleChapters(r.texts);
  });

  it('正文块之间有零字节填充、魔数第 4 字节不是 DE：照常读', async () => {
    const r = await read(write(buildUmd({ zeroPadding: true, magic4: 0x9c })));
    expectSampleChapters(r.texts);
  });

  it('正文含 HTML 特殊字符：转义', async () => {
    const chapters = [{ title: '第一章', body: `第一章${PARA}a<b>&"c"${PARA}` }];
    const r = await read(write(buildUmd({ chapters })));
    expect(r.texts[0]).toContain('a&lt;b&gt;&amp;');
  });
});

describe('UMD · 退路', () => {
  it('没有章节偏移：按标题在正文里定位', async () => {
    const r = await read(write(buildUmd({ offsets: false })));
    expect(r.titles).toEqual(BOOK.chapters.map(c => c.title));
    expectSampleChapters(r.texts);
  });

  it('偏移不递增（写坏了）：改按标题定位', async () => {
    const r = await read(write(buildUmd({ offsets: [0, 400, 200] })));
    expect(r.titles).toEqual(BOOK.chapters.map(c => c.title));
    expectSampleChapters(r.texts);
  });

  it('偏移超出正文：改按标题定位', async () => {
    const r = await read(write(buildUmd({ offsets: [0, 100, 99999999] })));
    expectSampleChapters(r.texts);
  });

  it('没有偏移也没有标题：按字数分段', async () => {
    const r = await read(write(buildUmd({ offsets: false, titles: false })));
    expect(r.titles).toEqual(['第 1 段']);
    BOOK.chapters.forEach(c => expect(r.texts[0]).toContain(c.marker));
  });
});

describe('UMD · 封面', () => {
  it('JPEG / GIF 封面可以取到', async () => {
    const jpeg = await read(write(buildUmd({ cover: JPEG })));
    expect(await jpeg.parser.getCoverImage()).toEqual({ buffer: JPEG, mimeType: 'image/jpeg' });
    const gif = await read(write(buildUmd({ cover: GIF })));
    expect((await gif.parser.getCoverImage())?.mimeType).toBe('image/gif');
  });

  it('没有封面、或封面不是图片：返回 null', async () => {
    expect(await (await read(write(buildUmd()))).parser.getCoverImage()).toBeNull();
    expect(await (await read(write(buildUmd({ cover: Buffer.from('not an image') })))).parser.getCoverImage()).toBeNull();
  });

  it('制作网站的 logo（如飞库网）不当作封面', async () => {
    const sha1 = crypto.createHash('sha1').update(GIF).digest('hex');
    PLACEHOLDER_COVER_SHA1.add(sha1);
    try {
      expect(await (await read(write(buildUmd({ cover: GIF })))).parser.getCoverImage()).toBeNull();
    } finally {
      PLACEHOLDER_COVER_SHA1.delete(sha1);
    }
  });
});

describe('UMD · 损坏的文件', () => {
  it('在块中间截断 → 文件不完整', async () => {
    const buf = buildUmd({ cover: JPEG });
    const file = write(buf.subarray(0, buf.length >> 1));
    expect((await loadError(file)).kind).toBe('incomplete');
    expect(await checkBookHealth(file, 'umd')).toEqual({ status: 'damaged', reason: '文件不完整（可能下载或复制中断）' });
  });

  it('正好截断在两个正文块之间（没有结束块、正文比声明的短）→ 文件不完整', async () => {
    const chapters = Array.from({ length: 3 }, (_, i) => ({ title: `第${i + 1}章`, body: `第${i + 1}章${PARA}${'字'.repeat(20000)}${PARA}` }));
    const buf = buildUmd({ chapters, noEnd: true });
    // 第二个正文块的起点：第一个 $ 正文块之后的 #F1
    const cut = buf.indexOf(Buffer.from([0x23, 0xf1, 0x00]));
    const file = write(buf.subarray(0, cut));
    expect((await loadError(file)).kind).toBe('incomplete');
  });

  it('没有结束块但内容完整：照常读', async () => {
    expectSampleChapters((await read(write(buildUmd({ noEnd: true })))).texts);
  });

  it('漫画版 → 明确说暂不支持', async () => {
    const file = write(buildUmd({ type: 2 }));
    expect((await loadError(file)).kind).toBe('comic');
    expect(await checkBookHealth(file, 'umd')).toEqual({ status: 'damaged', reason: '暂不支持漫画版 UMD' });
  });

  it('正文块解压失败 → 正文数据损坏', async () => {
    const buf = buildUmd();
    const first = buf.indexOf(Buffer.from([0x23, 0xf1, 0x00]));
    // 第一个正文块在 #F1 之前；把它的压缩数据改坏（保留 9 字节头）
    let start = first - 1;
    while (start > 0 && !(buf[start] === 0x24 && buf.readUInt32LE(start + 5) === first - start)) start--;
    buf.fill(0x55, start + 9, first);
    const file = write(buf);
    expect((await loadError(file)).kind).toBe('corrupt');
    expect(await checkBookHealth(file, 'umd')).toEqual({ status: 'damaged', reason: '正文数据损坏' });
  });

  it('不是 UMD 文件 → not_umd', async () => {
    expect((await loadError(write(Buffer.from('plain text')))).kind).toBe('not_umd');
  });
});
