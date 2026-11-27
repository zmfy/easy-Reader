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
import { PositionMapper } from '../../../src/services/txt-organize/position-map';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-position-map-'));
process.env.DATA_DIR = path.join(dir, 'data');

type L = Omit<Label, 'id'>;
const chap = (title: string): L => ({ type: 'chapter', title });

// 原书：前言 + 四章；「第七章」是夹在第二章正文里的另一套编号，现有规则把它切成了单独一章（原书第 2 章）。
// 整理版把它判为 stray_number 去掉、正文并回「第二章 青牛镇」：整理版 = 前言、第一章、第二章（b1–b4）、第三章
const TEXT = [
  '书名：青牛记', '作者：某人', '',
  '第一章 开端', '　　a1', 'a2',
  '第二章 青牛镇', 'b1', '', 'b2', '第七章', 'b3', 'b4',
  '第三章 结局', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
].join('\r\n');
const LABELS: Record<number, L> = {
  3: chap('第一章 开端'),
  6: chap('第二章 青牛镇'),
  10: { type: 'noise', noiseKind: 'stray_number' },
  13: chap('第三章 结局'),
};

let seq = 0;
/** 写原文、按判定结果生成整理版 EPUB，并建一个只有相关表的内存库 */
async function setup(text: string, labelsByLine: Record<number, L>) {
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
  db.prepare('INSERT INTO books (id, file_path, chapter_count, organized_from) VALUES (?, ?, ?, NULL)').run('orig', f, 4);
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
});
