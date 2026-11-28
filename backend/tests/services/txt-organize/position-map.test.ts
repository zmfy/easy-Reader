import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { readTxtLines } from '../../../src/services/txt-organize/lines';
import { Candidate } from '../../../src/services/txt-organize/candidates';
import { Label } from '../../../src/services/txt-organize/judge';
import { buildStructure } from '../../../src/services/txt-organize/structure';
import { writeOrganizedEpub } from '../../../src/services/txt-organize/writer';
import { TxtParser } from '../../../src/plugins/parser-txt';
import { EpubParser } from '../../../src/plugins/parser-epub';
import { decodeHtmlEntities } from '../../../src/utils/html';
import { PositionMapper } from '../../../src/services/txt-organize/position-map';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-position-map-'));
process.env.DATA_DIR = path.join(dir, 'data');

type L = Omit<Label, 'id'>;
const chap = (): L => ({ type: 'chapter' });

// 原书：前言 + 四章；「第七章」是夹在第二章正文里的另一套编号，现有规则把它切成了单独一章（原书第 2 章）。
// 整理版把它判为 stray_number 去掉、正文并回「第二章 青牛镇」：整理版 = 前言、第一章、第二章（b1–b4）、第三章
const TEXT = [
  '书名：青牛记', '作者：某人', '',
  '第一章 开端', '　　a1', 'a2',
  '第二章 青牛镇', 'b1', '', 'b2', '第七章', 'b3', 'b4',
  '第三章 结局', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
].join('\r\n');
const LABELS: Record<number, L> = {
  3: chap(),
  6: chap(),
  10: { type: 'noise', noiseKind: 'stray_number' },
  13: chap(),
};

let seq = 0;
/** 写原文、按判定结果生成整理版 EPUB，并建一个只有相关表的内存库 */
async function setup(text: string, labelsByLine: Record<number, L>, originalCount = 4) {
  const id = `org${seq++}`;
  const f = path.join(dir, `${id}.txt`);
  fs.writeFileSync(f, text);
  const candidates: Candidate[] = [];
  const labels: Label[] = [];
  for await (const line of readTxtLines(f)) {
    const lab = labelsByLine[line.lineNo];
    if (!lab) continue;
    const cid = candidates.length;
    candidates.push({
      id: cid, lineNo: line.lineNo, byteStart: line.byteStart, byteEnd: line.byteEnd, text: line.text.trim(),
      bodyChars: 1, bodyLines: 1, prevSnippet: '', nextSnippet: '', ruleHint: 'none',
    });
    labels.push({ id: cid, ...lab });
  }
  const structure = buildStructure(candidates, labels, fs.statSync(f).size);
  const { filePath, chapterMap } = await writeOrganizedEpub({ newBookId: id, sourcePath: f, structure, title: '青牛记（整理版）' });

  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, file_path TEXT, chapter_count INTEGER, organized_from TEXT);
    CREATE TABLE txt_organize_chapter_map (book_id TEXT NOT NULL, chapter_index INTEGER NOT NULL, src_start INTEGER NOT NULL, src_end INTEGER NOT NULL, PRIMARY KEY (book_id, chapter_index));
  `);
  db.prepare('INSERT INTO books (id, file_path, chapter_count, organized_from) VALUES (?, ?, ?, NULL)').run('orig', f, originalCount);
  db.prepare('INSERT INTO books (id, file_path, chapter_count, organized_from) VALUES (?, ?, ?, ?)').run(id, filePath, chapterMap.length, 'orig');
  const ins = db.prepare('INSERT INTO txt_organize_chapter_map (book_id, chapter_index, src_start, src_end) VALUES (?, ?, ?, ?)');
  for (const m of chapterMap) ins.run(id, m.chapterIndex, m.srcStart, m.srcEnd);
  return { f, id, db, chapterMap };
}

describe('PositionMapper', () => {
  it('原书第 3 章第 5 段 → 整理版对应章、对应段（合并了另一套编号的书）', async () => {
    const { f, id, db, chapterMap } = await setup(TEXT, LABELS);
    expect(chapterMap).toHaveLength(4);
    const m = await PositionMapper.create(f, id, db);
    // 整理版各章开头是 <h2> 标题（阅读器把它算作第 0 段），正文从第 1 段起
    expect(await m.mapProgress({ chapterIndex: 3, paragraphIndex: 5, paragraphOffset: 0.4 }))
      .toEqual({ chapterIndex: 3, paragraphIndex: 5, paragraphOffset: 0.4 });
    // 「第七章」那半：标题行在整理版被去掉 → 落在它前面一段（b2）；其后的 b3 → 整理版第二章的第 3 段
    expect(await m.mapProgress({ chapterIndex: 2, paragraphIndex: 0, paragraphOffset: 0.5 }))
      .toEqual({ chapterIndex: 2, paragraphIndex: 2, paragraphOffset: 0.5 });
    expect(await m.mapProgress({ chapterIndex: 2, paragraphIndex: 1, paragraphOffset: 0 }))
      .toEqual({ chapterIndex: 2, paragraphIndex: 3, paragraphOffset: 0 });
    // 原书第 0 章开头带着书名 / 作者（整理版的「前言」章），标题行 → 整理版「第一章」开头
    expect(await m.mapProgress({ chapterIndex: 0, paragraphIndex: 1, paragraphOffset: 0 }))
      .toEqual({ chapterIndex: 0, paragraphIndex: 2, paragraphOffset: 0 });
    expect(await m.mapProgress({ chapterIndex: 0, paragraphIndex: 2, paragraphOffset: 0 }))
      .toEqual({ chapterIndex: 1, paragraphIndex: 0, paragraphOffset: 0 });
    expect(await m.mapProgress({ chapterIndex: 0, paragraphIndex: 4, paragraphOffset: 0.9 }))
      .toEqual({ chapterIndex: 1, paragraphIndex: 2, paragraphOffset: 0.9 });
    // 原第二章第 2 段（b2，原文中间隔着空行）
    expect(await m.mapProgress({ chapterIndex: 1, paragraphIndex: 2, paragraphOffset: 0 }))
      .toEqual({ chapterIndex: 2, paragraphIndex: 2, paragraphOffset: 0 });
  });

  it('mapChapter：原书被合并掉的重复章节 → 整理版所在章', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db);
    expect([0, 1, 2, 3].map(c => m.mapChapter(c))).toEqual([0, 2, 2, 3]);
  });

  it('越界的章号 / 段落号夹到有效范围', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db);
    // 章号越界 → 原书最后一章；段落号越界 → 该章最后一段（c6）
    expect(await m.mapProgress({ chapterIndex: 99, paragraphIndex: 999, paragraphOffset: 0.3 }))
      .toEqual({ chapterIndex: 3, paragraphIndex: 6, paragraphOffset: 0.3 });
    // 负数 → 原书第 0 章第 0 段（书名，整理版「前言」章 <h2> 之后的第 1 段）
    expect(await m.mapProgress({ chapterIndex: -1, paragraphIndex: -5, paragraphOffset: 0 }))
      .toEqual({ chapterIndex: 0, paragraphIndex: 1, paragraphOffset: 0 });
    expect(m.mapChapter(99)).toBe(3);
    expect(m.mapChapter(-1)).toBe(0);
  });

  it('原文件已删除：按章节比例换算，不抛错', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    db.prepare("UPDATE books SET chapter_count = 8 WHERE id = 'orig'").run();
    fs.rmSync(f);
    const m = await PositionMapper.create(f, id, db);
    // 原书 8 章、整理版 4 章
    expect(await m.mapProgress({ chapterIndex: 5, paragraphIndex: 7, paragraphOffset: 0.5 }))
      .toEqual({ chapterIndex: 2, paragraphIndex: 0, paragraphOffset: 0 });
    expect(m.mapChapter(1)).toBe(0);
    expect(m.mapChapter(7)).toBe(3);
    expect(m.mapChapter(99)).toBe(3);
  });

  it('forceProportional：原文件还在也按章节比例换算', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db, { forceProportional: true });
    expect(await m.mapProgress({ chapterIndex: 3, paragraphIndex: 5, paragraphOffset: 0.4 }))
      .toEqual({ chapterIndex: 3, paragraphIndex: 0, paragraphOffset: 0 });
    expect([0, 1, 2, 3].map(c => m.mapChapter(c))).toEqual([0, 1, 2, 3]);
  });

  it('同一章多次换算只解析一次（按章缓存）', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db);
    const spy = jest.spyOn(TxtParser.prototype, 'getChapterContent');
    try {
      await m.mapProgress({ chapterIndex: 3, paragraphIndex: 1, paragraphOffset: 0 });
      await m.mapProgress({ chapterIndex: 3, paragraphIndex: 2, paragraphOffset: 0 });
      await m.mapProgress({ chapterIndex: 1, paragraphIndex: 0, paragraphOffset: 0 });
      expect(spy.mock.calls.map(c => c[0])).toEqual([3, 1]);
    } finally {
      spy.mockRestore();
    }
  });

  // 阅读器划线偏移 = .chapter-content 的 textContent：去标签、解码实体，块之间的换行照算
  const plain = (html: string) => decodeHtmlEntities(html.replace(/<[^>]*>/g, ''));
  const originalText = async (f: string, c: number) => {
    const t = new TxtParser();
    await t.load(f);
    return plain(await t.getChapterContent(c));
  };
  const organizedText = async (db: Database.Database, id: string, k: number) => {
    const e = new EpubParser();
    await e.load((db.prepare('SELECT file_path FROM books WHERE id = ?').get(id) as { file_path: string }).file_path);
    return plain(await e.getChapterContent(k));
  };

  it('mapTextRange：同章找得到，偏移处文字等于划线原文', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db);
    for (const text of ['c4', 'c3\nc4', '4']) {
      const start = (await originalText(f, 3)).indexOf(text);
      expect(start).toBeGreaterThan(0);
      const r = await m.mapTextRange(3, start, text);
      expect(r).toMatchObject({ chapterIndex: 3, located: true });
      expect((await organizedText(db, id, 3)).slice(r.start, r.end)).toBe(text);
    }
    // 原第 2 章（另一套编号的「第七章」）里的 b3 → 整理版第二章
    const start = (await originalText(f, 2)).indexOf('b3');
    const r = await m.mapTextRange(2, start, 'b3');
    expect(r).toMatchObject({ chapterIndex: 2, located: true });
    expect((await organizedText(db, id, 2)).slice(r.start, r.end)).toBe('b3');
  });

  it('mapTextRange：原章在整理版被拆成两章，划线在后半 → 后一章', async () => {
    const text = ['第一章 开端', 'a1', 'a2', '天崩地裂', 'd1', 'd2', '第二章 结局', 'e1'].join('\n');
    const { f, id, db, chapterMap } = await setup(text, { 0: chap(), 3: chap(), 6: chap() }, 2);
    expect(chapterMap).toHaveLength(3);
    const m = await PositionMapper.create(f, id, db);
    const orig = await originalText(f, 0);
    expect(orig).toContain('天崩地裂');
    const r = await m.mapTextRange(0, orig.indexOf('d2'), 'd2');
    expect(r).toMatchObject({ chapterIndex: 1, located: true });
    expect((await organizedText(db, id, 1)).slice(r.start, r.end)).toBe('d2');
    // 前半仍在第一章
    const a = await m.mapTextRange(0, orig.indexOf('a2'), 'a2');
    expect(a).toMatchObject({ chapterIndex: 0, located: true });
  });

  it('mapTextRange：整理版里找不到原文 → located=false，章节为换算章、长度不变', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const m = await PositionMapper.create(f, id, db);
    const start = (await originalText(f, 3)).indexOf('c2');
    const r = await m.mapTextRange(3, start, '不存在的话');
    expect(r.chapterIndex).toBe(3);
    expect(r.located).toBe(false);
    expect(r.end - r.start).toBe('不存在的话'.length);
  });

  const nthOf = (s: string, n: number) => {
    let i = -1;
    for (let k = 0; k <= n; k++) i = s.indexOf('他说', i + 1);
    return i;
  };

  it('mapTextRange：多处相同短文本取离换算位置最近的一处', async () => {
    // 原书第 0 章开头带着书名（整理版的「前言」章）：同一句话在两边的偏移不同，按原偏移找最近会错到别的一处
    const text = ['书名：某书', '', '第一章 开端', '他说', 'x1', '他说', 'x2', '他说', '第二章 尾声', 'y1'].join('\n');
    const { f, id, db } = await setup(text, { 2: chap(), 8: chap() }, 2);
    const m = await PositionMapper.create(f, id, db);
    const orig = await originalText(f, 0);
    const org = await organizedText(db, id, 1);
    expect(nthOf(orig, 1) - nthOf(org, 1)).not.toBe(0);
    for (const n of [0, 1, 2]) {
      const r = await m.mapTextRange(0, nthOf(orig, n), '他说');
      expect(r).toEqual({ chapterIndex: 1, start: nthOf(org, n), end: nthOf(org, n) + 2, located: true });
    }
  });

  it('mapTextRange：forceProportional / 原文件已删除时不抛错，在 mapChapter 的章里找', async () => {
    const { f, id, db } = await setup(TEXT, LABELS);
    const start = (await originalText(f, 3)).indexOf('c5');
    const m = await PositionMapper.create(f, id, db, { forceProportional: true });
    const r = await m.mapTextRange(3, start, 'c5');
    expect(r).toMatchObject({ chapterIndex: m.mapChapter(3), located: true });
    expect((await organizedText(db, id, r.chapterIndex)).slice(r.start, r.end)).toBe('c5');

    fs.rmSync(f);
    const gone = await PositionMapper.create(f, id, db);
    const g = await gone.mapTextRange(3, start, 'c5');
    expect(g).toMatchObject({ chapterIndex: gone.mapChapter(3), located: true });
    expect((await organizedText(db, id, g.chapterIndex)).slice(g.start, g.end)).toBe('c5');
    // 换算章里也没有：保留原偏移
    expect(await gone.mapTextRange(3, 7, '不存在')).toEqual({ chapterIndex: gone.mapChapter(3), start: 7, end: 10, located: false });
  });
});
