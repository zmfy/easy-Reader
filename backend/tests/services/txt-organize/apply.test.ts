import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type Database from 'better-sqlite3';

// 临时 DATA_DIR / BOOKS_DIR：必须在首次 require 源码之前设好
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-organize-apply-'));
process.env.DATA_DIR = path.join(ROOT, 'data');
process.env.BOOKS_DIR = path.join(ROOT, 'books');
fs.mkdirSync(process.env.BOOKS_DIR, { recursive: true });
fs.mkdirSync(path.join(process.env.DATA_DIR, 'covers'), { recursive: true });

jest.mock('../../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { userId: 'admin1', role: 'admin' };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const db: Database.Database = require('../../../src/db').getDb();
const { applyOrganizeDecision } = require('../../../src/services/txt-organize/apply') as typeof import('../../../src/services/txt-organize/apply');
const scanBatchRoutes = require('../../../src/routes/scan-batches').default;
const libraryRoutes = require('../../../src/routes/library').default;
const { selectFillCandidates } = require('../../../src/services/ai-batch-fill') as typeof import('../../../src/services/ai-batch-fill');
const { AI_FILL_VERSION } = require('../../../src/services/scan-versions') as typeof import('../../../src/services/scan-versions');
const { runScanTask } = require('../../../src/services/scan-walker');
const { createScanTask } = require('../../../src/services/scan-task');
const { readTxtLines } = require('../../../src/services/txt-organize/lines') as typeof import('../../../src/services/txt-organize/lines');
const { buildStructure } = require('../../../src/services/txt-organize/structure') as typeof import('../../../src/services/txt-organize/structure');
const { writeOrganizedEpub } = require('../../../src/services/txt-organize/writer') as typeof import('../../../src/services/txt-organize/writer');
/* eslint-enable @typescript-eslint/no-var-requires */
import type { Candidate } from '../../../src/services/txt-organize/candidates';
import type { Label } from '../../../src/services/txt-organize/judge';
import type { OrganizedDuplicatePayload } from '../../../src/services/txt-organize/job';

const BOOKS = process.env.BOOKS_DIR!;
const COVERS = path.join(process.env.DATA_DIR!, 'covers');

// 同 position-map.test.ts：原书 前言 + 四章（第 2 章是夹在第二章里的「第七章」）；整理版 = 前言、第一章、第二章、第三章
const TEXT = [
  '书名：青牛记', '作者：某人', '',
  '第一章 开端', '　　a1', 'a2',
  '第二章 青牛镇', 'b1', '', 'b2', '第七章', 'b3', 'b4',
  '第三章 结局', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6',
].join('\r\n');
type L = Omit<Label, 'id'>;
const LABELS: Record<number, L> = {
  3: { type: 'chapter' },
  6: { type: 'chapter' },
  10: { type: 'noise', noiseKind: 'stray_number' },
  13: { type: 'chapter' },
};

let seq = 0;

interface Fixture {
  origId: string;
  orgId: string;
  jobId: string;
  batchId: string;
  itemId: string;
  src: string;
  orgFile: string;
  payload: OrganizedDuplicatePayload;
}

/** 照 job.ts 的入库方式造一份待审核的整理结果 */
async function makeOrganized(): Promise<Fixture> {
  const n = seq++;
  const origId = `orig${n}`;
  const jobId = `job${n}`;
  const src = path.join(BOOKS, `青牛记${n}.txt`);
  fs.writeFileSync(src, TEXT);
  const st = fs.statSync(src);
  db.prepare(
    `INSERT INTO books (id, title, author, file_path, file_format, status, file_size, file_mtime, chapter_count)
     VALUES (?, '青牛记', '某人', ?, 'txt', 'normal', ?, ?, 4)`
  ).run(origId, src, st.size, st.mtimeMs);

  const candidates: Candidate[] = [];
  const labels: Label[] = [];
  for await (const line of readTxtLines(src)) {
    const lab = LABELS[line.lineNo];
    if (!lab) continue;
    const cid = candidates.length;
    candidates.push({
      id: cid, lineNo: line.lineNo, byteStart: line.byteStart, byteEnd: line.byteEnd, text: line.text.trim(),
      bodyChars: 1, bodyLines: 1, prevSnippet: '', nextSnippet: '', ruleHint: 'none',
    });
    labels.push({ id: cid, ...lab });
  }
  const structure = buildStructure(candidates, labels, st.size);
  const { filePath, chapterMap } = await writeOrganizedEpub({ newBookId: jobId, sourcePath: src, structure, title: '青牛记（整理版）' });
  // 整理版的封面副本
  const cover = `/covers/${jobId}-x.png`;
  fs.writeFileSync(path.join(COVERS, `${jobId}-x.png`), 'png');
  db.prepare(
    `INSERT INTO books (id, title, author, cover_url, file_path, file_format, status, file_size, chapter_count, organized_from, organized_job_id)
     VALUES (?, '青牛记（整理版）', '某人', ?, ?, 'epub', 'pending_review', ?, ?, ?, ?)`
  ).run(jobId, cover, filePath, fs.statSync(filePath).size, chapterMap.length, origId, jobId);
  const insertMap = db.prepare('INSERT INTO txt_organize_chapter_map (book_id, chapter_index, src_start, src_end) VALUES (?, ?, ?, ?)');
  for (const m of chapterMap) insertMap.run(jobId, m.chapterIndex, m.srcStart, m.srcEnd);
  db.prepare(
    `INSERT INTO txt_organize_jobs (id, book_id, requested_by, status, src_size, src_mtime, result_book_id, finished_at)
     VALUES (?, ?, 'u1', 'review', ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(jobId, origId, st.size, st.mtimeMs, jobId);

  const toc = ['前言', '第一章 开端', '第二章 青牛镇', '第三章 结局'].map(title => ({ title, level: 0 }));
  const payload: OrganizedDuplicatePayload = {
    job_id: jobId,
    original: { book_id: origId, title: '青牛记', file_path: src, chapter_count: 4, toc },
    organized: { book_id: jobId, title: '青牛记（整理版）', file_path: filePath, chapter_count: 4, toc },
    notes: [], batches: 1, candidate_count: 4,
    requested_by: { user_id: 'u1', username: 'reader' },
  };
  const batchId = `batch${n}`;
  const itemId = `item${n}`;
  db.prepare("INSERT INTO scan_batches (id, task_id, status, summary_counts, kind) VALUES (?, ?, 'pending', ?, 'organize')")
    .run(batchId, jobId, JSON.stringify({ organized_duplicate: 1 }));
  db.prepare("INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, 'organized_duplicate', ?)")
    .run(itemId, batchId, JSON.stringify(payload));
  return { origId, orgId: jobId, jobId, batchId, itemId, src, orgFile: filePath, payload };
}

/** 两个读者在原书上的进度 / 书签 / 书架 / 历史，以及原书的 AI 数据 */
function addReaderData(origId: string): void {
  const progress = db.prepare(
    `INSERT INTO reading_progress (id, user_id, book_id, chapter_index, chapter_title, scroll_top, paragraph_index, paragraph_offset, updated_at)
     VALUES (?, ?, ?, ?, '旧标题', 500, ?, ?, ?)`
  );
  progress.run(`p-u1-${origId}`, 'u1', origId, 3, 5, 0.4, '2026-11-20 10:00:00');
  progress.run(`p-u2-${origId}`, 'u2', origId, 2, 1, 0, '2026-11-21 10:00:00');
  const bookmark = db.prepare('INSERT INTO bookmarks (id, user_id, book_id, chapter_index, scroll_top, note) VALUES (?, ?, ?, ?, ?, ?)');
  bookmark.run(`bm1-${origId}`, 'u1', origId, 1, 300, '一');
  bookmark.run(`bm2-${origId}`, 'u2', origId, 3, 120, '二');
  bookmark.run(`bm3-${origId}`, 'u2', origId, 2, 80, null);
  for (const u of ['u1', 'u2']) {
    db.prepare("INSERT INTO shelf (id, user_id, book_id, added_at, last_read_at) VALUES (?, ?, ?, '2026-11-01 00:00:00', '2026-11-20 10:00:00')")
      .run(`s-${u}-${origId}`, u, origId);
    db.prepare("INSERT INTO reading_history (user_id, book_id, opened_at) VALUES (?, ?, '2026-11-20 10:00:00')").run(u, origId);
  }
  db.prepare("INSERT INTO book_ai_metadata (book_id, recommended_tags, similar_works, generated_by) VALUES (?, '[\"仙侠\"]', '[]', 'deepseek')").run(origId);
  db.prepare("INSERT INTO ai_recaps (book_id, chapter_index, paragraph_index, content) VALUES (?, 1, 0, '提要')").run(origId);
  db.prepare("INSERT INTO ai_suggestions (book_id, data) VALUES (?, '{}')").run(origId);
  db.prepare("INSERT INTO book_chapter_overrides (book_id, chapter_index, normalized_title) VALUES (?, 1, '第一章')").run(origId);
}

const book = (id: string) => db.prepare('SELECT * FROM books WHERE id = ?').get(id) as Record<string, unknown> | undefined;
const rowsOf = (table: string, bookId: string, order = 'user_id') =>
  db.prepare(`SELECT * FROM ${table} WHERE book_id = ? ORDER BY ${order}`).all(bookId) as Array<Record<string, unknown>>;
const job = (id: string) => db.prepare('SELECT * FROM txt_organize_jobs WHERE id = ?').get(id) as Record<string, unknown>;
const batch = (id: string) => db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(id) as Record<string, unknown>;

let server: Server;
let base: string;
let libraryBase: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/scan-batches', scanBatchRoutes);
  app.use('/api/library', libraryRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/scan-batches`;
  libraryBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/library`;
});
afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  fs.rmSync(ROOT, { recursive: true, force: true });
});

const call = (method: string, url: string, body?: unknown) => fetch(base + url, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  db.exec(`
    DELETE FROM txt_organize_jobs; DELETE FROM txt_organize_chapter_map; DELETE FROM txt_organize_rejections;
    DELETE FROM scan_batch_items; DELETE FROM scan_batches; DELETE FROM scan_tasks; DELETE FROM books;
    DELETE FROM reading_progress; DELETE FROM bookmarks; DELETE FROM shelf; DELETE FROM reading_history;
    DELETE FROM book_ai_metadata; DELETE FROM ai_recaps; DELETE FROM ai_suggestions; DELETE FROM book_chapter_overrides;
    DELETE FROM scan_skipped_files; DELETE FROM audit_log;
  `);
  for (const f of fs.readdirSync(BOOKS)) fs.rmSync(path.join(BOOKS, f), { force: true });
});

describe('applyOrganizeDecision', () => {
  it('keep_new_hide_old：整理版可见、改名；原书隐藏为副本；两个用户的进度 / 书签 / 书架 / 历史都迁到整理版且位置换算正确', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    // 另一本书原来是原书的副本：改为指向整理版
    db.prepare("INSERT INTO books (id, title, file_path, file_format, status, duplicate_of) VALUES ('dup', '青牛记', '/x/dup.txt', 'txt', 'duplicate', ?)")
      .run(fx.origId);

    const summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    expect(summary).toEqual({ decision: 'keep_new_hide_old', migrated: { progress: 2, bookmarks: 3, shelf: 2, history: 2 }, warnings: [] });

    expect(book(fx.orgId)).toMatchObject({ title: '青牛记', status: 'normal' });
    expect(book(fx.origId)).toMatchObject({ status: 'duplicate', duplicate_of: fx.orgId });
    expect(book('dup')).toMatchObject({ duplicate_of: fx.orgId });
    expect(fs.existsSync(fx.src)).toBe(true);

    // 进度精确到段落（见 position-map.test.ts），章节标题取整理版
    expect(rowsOf('reading_progress', fx.orgId).map(r => [r.user_id, r.chapter_index, r.paragraph_index, r.paragraph_offset, r.chapter_title, r.scroll_top]))
      .toEqual([['u1', 3, 5, 0.4, '第三章 结局', 0], ['u2', 2, 3, 0, '第二章 青牛镇', 0]]);
    // 书签：原第 1 章 → 整理版第 2 章，第 3 章 → 第 3 章，第 2 章（第七章）→ 第 2 章；scroll_top 归零
    expect(rowsOf('bookmarks', fx.orgId, 'id').map(r => [r.id, r.user_id, r.chapter_index, r.scroll_top, r.note]))
      .toEqual([[`bm1-${fx.origId}`, 'u1', 2, 0, '一'], [`bm2-${fx.origId}`, 'u2', 3, 0, '二'], [`bm3-${fx.origId}`, 'u2', 2, 0, null]]);
    expect(rowsOf('shelf', fx.orgId).map(r => r.user_id)).toEqual(['u1', 'u2']);
    expect(rowsOf('reading_history', fx.orgId).map(r => r.user_id)).toEqual(['u1', 'u2']);
    for (const t of ['reading_progress', 'bookmarks', 'shelf', 'reading_history']) expect(rowsOf(t, fx.origId)).toEqual([]);

    // AI 书目信息复制；按章节序号存的数据删掉
    expect(rowsOf('book_ai_metadata', fx.orgId, 'book_id')).toEqual([expect.objectContaining({ recommended_tags: '["仙侠"]', generated_by: 'deepseek' })]);
    for (const t of ['ai_recaps', 'ai_suggestions', 'book_chapter_overrides']) {
      expect(rowsOf(t, fx.origId, 'book_id')).toEqual([]);
      expect(rowsOf(t, fx.orgId, 'book_id')).toEqual([]);
    }

    expect(job(fx.jobId)).toMatchObject({ status: 'done' });
    expect(job(fx.jobId).finished_at).toBeTruthy();
    const b = batch(fx.batchId);
    expect(b).toMatchObject({ status: 'applied', applied_by: 'admin1' });
    expect(JSON.parse(b.apply_summary as string)).toEqual(summary);
    const audit = db.prepare("SELECT * FROM audit_log WHERE action = 'organize_apply'").all() as Array<Record<string, unknown>>;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ user_id: 'admin1', resource_id: fx.orgId });
    expect(JSON.parse(audit[0].details as string)).toMatchObject({ decision: 'keep_new_hide_old', original_book_id: fx.origId });
  });

  it('keep_new_delete_record：原书记录删除、文件保留、记录跳过，下次扫描不再作为新书', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    const summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_record', 'admin1', db);
    expect(summary.migrated).toEqual({ progress: 2, bookmarks: 3, shelf: 2, history: 2 });
    expect(book(fx.origId)).toBeUndefined();
    expect(fs.existsSync(fx.src)).toBe(true);
    expect(rowsOf('reading_progress', fx.orgId)).toHaveLength(2);
    expect(rowsOf('book_ai_metadata', fx.orgId, 'book_id')).toHaveLength(1);
    const st = fs.statSync(fx.src);
    expect(db.prepare('SELECT file_size, file_mtime FROM scan_skipped_files WHERE file_path = ?').get(fx.src))
      .toEqual({ file_size: st.size, file_mtime: st.mtimeMs });

    const opts = { mode: 'auto', ai_fill: false, full_rescan: false };
    const task = createScanTask('admin1', opts);
    await runScanTask(task.id, opts);
    expect(db.prepare('SELECT id FROM books WHERE file_path = ?').get(fx.src)).toBeUndefined();
    // 整理版不会被扫描当孤儿删掉
    expect(book(fx.orgId)).toMatchObject({ status: 'normal' });
  });

  it('keep_new_delete_file：原文件被删除', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_file', 'admin1', db);
    expect(book(fx.origId)).toBeUndefined();
    expect(fs.existsSync(fx.src)).toBe(false);
    expect(fs.existsSync(fx.orgFile)).toBe(true);
    expect(book(fx.orgId)).toMatchObject({ status: 'normal', title: '青牛记' });
    expect(rowsOf('bookmarks', fx.orgId, 'id')).toHaveLength(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM scan_skipped_files').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT resource_id, file_path FROM audit_log WHERE action = 'delete_book_file'").all())
      .toEqual([{ resource_id: fx.origId, file_path: fx.src }]);
  });

  it('keep_new_delete_file：事务里后续语句出错时整体回滚，原文件不动', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    db.exec("CREATE TEMP TRIGGER fail_job BEFORE UPDATE ON txt_organize_jobs BEGIN SELECT RAISE(ABORT, 'boom'); END");
    try {
      // 不用 toThrow：SqliteError 的构造函数由原生模块按进程缓存，同一 jest worker 先跑过别的测试文件时，
      // 它继承的是那个文件沙箱里的 Error，instanceof Error 为 false，toThrow 会误报「did not throw」
      await expect(applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_file', 'admin1', db))
        .rejects.toMatchObject({ message: expect.stringContaining('boom') });
    } finally {
      db.exec('DROP TRIGGER fail_job');
    }
    expect(fs.existsSync(fx.src)).toBe(true);
    expect(book(fx.origId)).toMatchObject({ status: 'normal' });
    expect(book(fx.orgId)).toMatchObject({ status: 'pending_review', title: '青牛记（整理版）' });
    expect(rowsOf('reading_progress', fx.origId)).toHaveLength(2);
    expect(rowsOf('bookmarks', fx.orgId)).toEqual([]);
    expect(batch(fx.batchId)).toMatchObject({ status: 'pending' });
    expect(job(fx.jobId)).toMatchObject({ status: 'review' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });

  it('keep_new_delete_file：提交后删文件失败只记警告，不回滚', async () => {
    const fx = await makeOrganized();
    const realRm = fs.rmSync;
    const realSrc = fs.realpathSync(fx.src);
    const rm = jest.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (p === realSrc) throw new Error('EBUSY');
      realRm(p, o);
    });
    let summary;
    try {
      summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_file', 'admin1', db);
    } finally {
      rm.mockRestore();
    }
    expect(summary.warnings).toEqual([expect.stringContaining('EBUSY')]);
    expect(fs.existsSync(fx.src)).toBe(true);
    expect(book(fx.origId)).toBeUndefined();
    expect(book(fx.orgId)).toMatchObject({ status: 'normal' });
    expect(JSON.parse(batch(fx.batchId).apply_summary as string)).toEqual(summary);
  });

  it('keep_new_delete_file：提交后写审计日志失败只记警告，不报错', async () => {
    const fx = await makeOrganized();
    const audit = require('../../../src/services/audit-log') as typeof import('../../../src/services/audit-log');
    const realAudit = audit.writeAudit;
    const spy = jest.spyOn(audit, 'writeAudit').mockImplementation((e) => {
      if (e.action === 'delete_book_file') throw new Error('disk full');
      return realAudit(e);
    });
    let summary;
    try {
      summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_file', 'admin1', db);
    } finally {
      spy.mockRestore();
    }
    expect(summary.warnings).toEqual([expect.stringContaining('disk full')]);
    expect(fs.existsSync(fx.src)).toBe(false);
    expect(book(fx.orgId)).toMatchObject({ status: 'normal' });
    expect(JSON.parse(batch(fx.batchId).apply_summary as string)).toEqual(summary);
  });

  it('keep_old：提交后删整理版文件 / 封面失败只记警告，不报错', async () => {
    const fx = await makeOrganized();
    const realRm = fs.rmSync;
    const realOrg = fs.realpathSync(fx.orgFile);
    const rm = jest.spyOn(fs, 'rmSync').mockImplementation((p, o) => {
      if (p === realOrg || String(p).includes(`${fx.orgId}-`)) throw new Error('EPERM');
      realRm(p, o);
    });
    let summary;
    try {
      summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_old', 'admin1', db);
    } finally {
      rm.mockRestore();
    }
    expect(summary.warnings).toEqual([expect.stringContaining('EPERM'), expect.stringContaining('EPERM')]);
    expect(book(fx.orgId)).toBeUndefined();
    expect(job(fx.jobId)).toMatchObject({ status: 'done' });
    expect(JSON.parse(batch(fx.batchId).apply_summary as string)).toEqual(summary);
  });

  it('keep_old：整理版记录和文件删除，写拒绝记录，原书数据不变', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    const before = Object.fromEntries(['reading_progress', 'bookmarks', 'shelf', 'reading_history'].map(t => [t, rowsOf(t, fx.origId)]));
    const summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_old', 'admin1', db);
    expect(summary).toEqual({ decision: 'keep_old', migrated: { progress: 0, bookmarks: 0, shelf: 0, history: 0 }, warnings: [] });

    expect(book(fx.orgId)).toBeUndefined();
    expect(fs.existsSync(fx.orgFile)).toBe(false);
    expect(fs.readdirSync(COVERS).filter(f => f.startsWith(fx.orgId))).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM txt_organize_chapter_map WHERE book_id = ?').get(fx.orgId)).toEqual({ n: 0 });
    expect(book(fx.origId)).toMatchObject({ status: 'normal', duplicate_of: null, title: '青牛记' });
    for (const [t, rows] of Object.entries(before)) expect(rowsOf(t, fx.origId)).toEqual(rows);
    expect(rowsOf('book_ai_metadata', fx.origId, 'book_id')).toHaveLength(1);
    expect(db.prepare('SELECT book_id, file_size, file_mtime FROM txt_organize_rejections').all())
      .toEqual([{ book_id: fx.origId, file_size: fs.statSync(fx.src).size, file_mtime: fs.statSync(fx.src).mtimeMs }]);
    expect(job(fx.jobId)).toMatchObject({ status: 'done' });
    expect(batch(fx.batchId)).toMatchObject({ status: 'applied' });
  });

  it('原 TXT 在审核前已被删除：keep_new_* 照常完成（进度按比例换算），keep_old 只删整理版', async () => {
    const a = await makeOrganized();
    addReaderData(a.origId);
    fs.rmSync(a.src);
    await applyOrganizeDecision({ payload: a.payload }, 'keep_new_delete_file', 'admin1', db);
    expect(book(a.origId)).toBeUndefined();
    // 原书 4 章、整理版 4 章：按章节比例，段落回到章首
    expect(rowsOf('reading_progress', a.orgId).map(r => [r.user_id, r.chapter_index, r.paragraph_index]))
      .toEqual([['u1', 3, 0], ['u2', 2, 0]]);
    expect(rowsOf('bookmarks', a.orgId, 'id').map(r => r.chapter_index)).toEqual([1, 3, 2]);

    const b = await makeOrganized();
    addReaderData(b.origId);
    fs.rmSync(b.src);
    await applyOrganizeDecision({ payload: b.payload }, 'keep_old', 'admin1', db);
    expect(book(b.orgId)).toBeUndefined();
    expect(fs.existsSync(b.orgFile)).toBe(false);
    expect(book(b.origId)).toMatchObject({ status: 'normal' });
    expect(rowsOf('reading_progress', b.origId)).toHaveLength(2);
  });

  it('原 TXT 在整理后被修改：不按段落换算，改按章节比例', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    fs.appendFileSync(fx.src, '\r\nc7');
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    expect(rowsOf('reading_progress', fx.orgId).map(r => [r.user_id, r.chapter_index, r.paragraph_index]))
      .toEqual([['u1', 3, 0], ['u2', 2, 0]]);
  });

  it('原书章节数未知：按章节序号一一对应并夹到整理版范围', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    db.prepare('UPDATE books SET chapter_count = NULL WHERE id = ?').run(fx.origId);
    db.prepare("UPDATE bookmarks SET chapter_index = 9 WHERE id = ?").run(`bm1-${fx.origId}`);
    fs.rmSync(fx.src);
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    expect(rowsOf('bookmarks', fx.orgId, 'id').map(r => r.chapter_index)).toEqual([3, 3, 2]);
  });

  it('同一用户原书和整理版都有进度：保留较新的', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    const progress = db.prepare(
      `INSERT INTO reading_progress (id, user_id, book_id, chapter_index, chapter_title, paragraph_index, paragraph_offset, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
    );
    // u1 在整理版上的进度更新（2026-11-25）：保留；u2 的更旧（2026-11-01）：用原书换算后的
    progress.run('po-u1', 'u1', fx.orgId, 1, '整理版上读的', 2, '2026-11-25 10:00:00');
    progress.run('po-u2', 'u2', fx.orgId, 0, '整理版上读的', 1, '2026-11-01 10:00:00');
    db.prepare("INSERT INTO shelf (id, user_id, book_id, added_at, last_read_at) VALUES ('so-u1', 'u1', ?, '2026-11-02 00:00:00', '2026-11-25 10:00:00')").run(fx.orgId);
    db.prepare("INSERT INTO reading_history (user_id, book_id, opened_at) VALUES ('u2', ?, '2026-11-01 00:00:00')").run(fx.orgId);

    const summary = await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    expect(summary.migrated).toEqual({ progress: 1, bookmarks: 3, shelf: 1, history: 2 });
    expect(rowsOf('reading_progress', fx.orgId).map(r => [r.user_id, r.chapter_index, r.paragraph_index, r.chapter_title]))
      .toEqual([['u1', 1, 2, '整理版上读的'], ['u2', 2, 3, '第二章 青牛镇']]);
    expect(rowsOf('shelf', fx.orgId).map(r => [r.user_id, r.id])).toEqual([['u1', 'so-u1'], ['u2', `s-u2-${fx.origId}`]]);
    expect(rowsOf('reading_history', fx.orgId).map(r => [r.user_id, r.opened_at]))
      .toEqual([['u1', '2026-11-20 10:00:00'], ['u2', '2026-11-20 10:00:00']]);
    for (const t of ['reading_progress', 'shelf', 'reading_history']) expect(rowsOf(t, fx.origId)).toEqual([]);
  });

  it.each(['keep_new_hide_old', 'keep_new_delete_record', 'keep_new_delete_file'] as const)(
    '%s：原书的完结状态 / 标签 / 评分 / 日期 / 系列 / 手动编辑字段 / AI 填充状态复制到整理版', async (decision) => {
      const fx = await makeOrganized();
      const cols = ['is_finished', 'tags', 'rating', 'publish_date', 'finish_date', 'series_id',
        'manually_edited_fields', 'ai_fill_version', 'ai_fill_status', 'ai_reviewed_at'];
      db.prepare(
        `UPDATE books SET is_finished = 1, tags = '["仙侠","凡人"]', rating = 8.6, publish_date = '2008-01-01', finish_date = '2013-09-23',
           series_id = 'series-x', manually_edited_fields = '["title"]', ai_fill_version = ?, ai_fill_status = 'filled',
           ai_reviewed_at = '2026-11-01 00:00:00'
         WHERE id = ?`
      ).run(AI_FILL_VERSION, fx.origId);
      const expected = db.prepare(`SELECT ${cols.join(', ')} FROM books WHERE id = ?`).get(fx.origId);

      await applyOrganizeDecision({ payload: fx.payload }, decision, 'admin1', db);
      expect(db.prepare(`SELECT ${cols.join(', ')} FROM books WHERE id = ?`).get(fx.orgId)).toEqual(expected);
      expect(selectFillCandidates(db, false).map(c => c.id)).not.toContain(fx.orgId);
    });

  it('批次已处理：不再执行', async () => {
    const fx = await makeOrganized();
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    await expect(applyOrganizeDecision({ payload: fx.payload }, 'keep_old', 'admin1', db)).rejects.toThrow('审核批次不存在或已处理');
    expect(book(fx.orgId)).toMatchObject({ status: 'normal' });
  });
});

describe('审核批次路由', () => {
  it('丢弃 organize 批次等同 keep_old', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    const r = await call('DELETE', `/${fx.batchId}`);
    expect(r.status).toBe(200);
    expect(book(fx.orgId)).toBeUndefined();
    expect(fs.existsSync(fx.orgFile)).toBe(false);
    expect(book(fx.origId)).toMatchObject({ status: 'normal' });
    expect(rowsOf('reading_progress', fx.origId)).toHaveLength(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM txt_organize_rejections').get()).toEqual({ n: 1 });
    expect(batch(fx.batchId)).toMatchObject({ status: 'discarded' });
    expect(job(fx.jobId)).toMatchObject({ status: 'done' });
  });

  it('「应用批次」未选择时默认 keep_new_hide_old', async () => {
    const fx = await makeOrganized();
    addReaderData(fx.origId);
    const r = await call('POST', `/${fx.batchId}/apply`);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ decision: 'keep_new_hide_old' });
    expect(book(fx.origId)).toMatchObject({ status: 'duplicate', duplicate_of: fx.orgId });
    expect(book(fx.orgId)).toMatchObject({ status: 'normal' });
  });

  it('PATCH 记录审核决定后应用；不认识的决定 422', async () => {
    const fx = await makeOrganized();
    expect((await call('PATCH', `/${fx.batchId}/items/${fx.itemId}`, { decision: 'accept', payload: { decision: 'nope' } })).status).toBe(422);
    expect((await call('PATCH', `/${fx.batchId}/items/${fx.itemId}`, { decision: 'accept', payload: { decision: 'keep_new_delete_file' } })).status).toBe(200);
    const r = await call('POST', `/${fx.batchId}/apply`);
    expect(r.status).toBe(200);
    expect(book(fx.origId)).toBeUndefined();
    expect(fs.existsSync(fx.src)).toBe(false);
  });
});

describe('删除整理版（DELETE /api/library/:id）', () => {
  const del = (id: string, query = '') => fetch(`${libraryBase}/${id}${query}`, { method: 'DELETE' });

  it('已采用的整理版连文件一起删除：记录、文件、封面副本都没了', async () => {
    const fx = await makeOrganized();
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_delete_record', 'admin1', db);
    const r = await del(fx.orgId);
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ files_deleted: 1, records_deleted: 1 });
    expect(book(fx.orgId)).toBeUndefined();
    expect(fs.existsSync(fx.orgFile)).toBe(false);
    expect(fs.readdirSync(COVERS).filter(f => f.startsWith(`${fx.orgId}-`))).toEqual([]);
  });

  it('原书隐藏为整理版的副本：级联删除两本，各自的文件都删掉', async () => {
    const fx = await makeOrganized();
    await applyOrganizeDecision({ payload: fx.payload }, 'keep_new_hide_old', 'admin1', db);
    const r = await del(fx.orgId, '?cascade_duplicates=true');
    expect(r.status).toBe(200);
    expect((await r.json()).data).toMatchObject({ files_deleted: 2, records_deleted: 2 });
    expect(book(fx.orgId)).toBeUndefined();
    expect(book(fx.origId)).toBeUndefined();
    expect(fs.existsSync(fx.orgFile)).toBe(false);
    expect(fs.existsSync(fx.src)).toBe(false);
  });

  it('待审核的整理版不能直接删除：返回 409，记录和文件都还在', async () => {
    const fx = await makeOrganized();
    const r = await del(fx.orgId);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe('PENDING_REVIEW');
    expect(book(fx.orgId)).toBeDefined();
    expect(fs.existsSync(fx.orgFile)).toBe(true);
  });

  it('不是整理版的书：文件在书库外（哪怕在整理版目录里）仍被拒绝', async () => {
    const fx = await makeOrganized();
    db.prepare("INSERT INTO books (id, title, file_path, file_format, status) VALUES ('fake', '冒充', ?, 'epub', 'normal')").run(fx.orgFile);
    const r = await del('fake');
    expect(r.status).toBe(500);
    expect((await r.json()).message).toMatch(/outside root/);
    expect(fs.existsSync(fx.orgFile)).toBe(true);
    expect(book('fake')).toBeDefined();
  });
});
