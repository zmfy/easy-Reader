import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import type Database from 'better-sqlite3';

// 临时 DATA_DIR / BOOKS_DIR：必须在首次 require 源码之前设好
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'organize-route-')));
process.env.DATA_DIR = path.join(ROOT, 'data');
process.env.BOOKS_DIR = path.join(ROOT, 'books');
fs.mkdirSync(process.env.BOOKS_DIR, { recursive: true });
fs.mkdirSync(path.join(process.env.DATA_DIR, 'covers'), { recursive: true });

// 当前登录用户（各用例切换管理员 / 读者）
let mockUser = { userId: 'u-admin', role: 'admin' };
jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = mockUser;
      next();
    },
  };
});

// AI：「第…章」→ chapter，其余 → noise/text（同 job.test.ts）
let mockAiConfigured = true;
jest.mock('../../src/ai/ai-manager', () => {
  const actual = jest.requireActual('../../src/ai/ai-manager');
  return {
    ...actual,
    isAiConfigured: () => mockAiConfigured,
    aiManager: {
      chat: async (prompt: string) => {
        const labels = [...prompt.matchAll(/^#(\d+)\t([^\t]+)\t/gm)].map(m => (
          /^第.+章/.test(m[2])
            ? { id: Number(m[1]), type: 'chapter' }
            : { id: Number(m[1]), type: 'noise', noiseKind: 'text' }
        ));
        return JSON.stringify({ labels, notes: ['第二章疑似缺字'] });
      },
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const db: Database.Database = require('../../src/db').getDb();
const readerRoutes = require('../../src/routes/reader').default;
const libraryRoutes = require('../../src/routes/library').default;
const opdsRoutes = require('../../src/routes/opds').default;
const shelfRoutes = require('../../src/routes/shelf').default;
const historyRoutes = require('../../src/routes/history').default;
const settingsRoutes = require('../../src/routes/settings').default;
const { notifyScanReview } = require('../../src/services/notices');
const { issueOpdsPassword } = require('../../src/services/opds-credentials');
const { runScanTask } = require('../../src/services/scan-walker');
const { createScanTask, getScanTaskById } = require('../../src/services/scan-task');
/* eslint-enable @typescript-eslint/no-var-requires */

jest.setTimeout(20000);

const DATA = process.env.DATA_DIR!;
const BOOKS = process.env.BOOKS_DIR!;
const ORGANIZED = path.join(DATA, 'organized');
const ADMIN = { userId: 'u-admin', role: 'admin' };
const READER = { userId: 'u-reader', role: 'user' };

const TEXT = [
  '书名：测试书', '作者：某人', '',
  '第一章 开端', '　　内容一。', '', '第二章 发展', '内容二。', '第三章 结局', '内容三。',
].join('\n');

let server: Server;
let base: string;
let opdsAuth = '';
beforeAll(async () => {
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u-admin', 'boss', 'x', 'admin')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u-reader', 'reader', 'x', 'user')").run();
  opdsAuth = 'Basic ' + Buffer.from(`reader:${issueOpdsPassword(db, 'u-reader')}`).toString('base64');
  const app = express();
  app.use(express.json());
  app.use('/api/reader', readerRoutes);
  app.use('/api/library', libraryRoutes);
  app.use('/api/shelf', shelfRoutes);
  app.use('/api/history', historyRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/opds', opdsRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise(r => setTimeout(r, 10));
  if (!cond()) throw new Error(`等待超时：${what}`);
}
const settle = () => waitFor(() =>
  (db.prepare("SELECT COUNT(*) AS n FROM txt_organize_jobs WHERE status IN ('pending', 'running')").get() as { n: number }).n === 0,
  '没有 pending / running 的整理任务');

beforeEach(() => {
  mockUser = ADMIN;
  mockAiConfigured = true;
  db.exec(`
    DELETE FROM txt_organize_jobs; DELETE FROM txt_organize_chapter_map; DELETE FROM scan_batch_items;
    DELETE FROM scan_batches; DELETE FROM notices; DELETE FROM books; DELETE FROM scan_tasks;
    DELETE FROM shelf; DELETE FROM reading_history; DELETE FROM reading_progress;
    DELETE FROM settings WHERE key = 'txt_organize_allow_readers';
  `);
  fs.rmSync(ORGANIZED, { recursive: true, force: true });
  for (const f of fs.readdirSync(BOOKS)) fs.rmSync(path.join(BOOKS, f), { force: true });
});
afterEach(async () => { await settle(); });

function addBook(id: string, format = 'txt'): string {
  const file = path.join(BOOKS, `${id}.${format}`);
  fs.writeFileSync(file, TEXT);
  db.prepare(
    `INSERT INTO books (id, title, author, file_path, file_format, status, file_size)
     VALUES (?, '测试书', '某人', ?, ?, 'normal', ?)`
  ).run(id, file, format, fs.statSync(file).size);
  return file;
}

const api = (p: string, init?: RequestInit) => fetch(`${base}/api${p}`, init);
const post = (p: string) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

/** 读者发起整理并等它生成待审核的整理版，返回整理版 id */
async function makePendingOrganized(bookId: string): Promise<string> {
  addBook(bookId);
  const res = await post(`/reader/${bookId}/organize`);
  expect(res.status).toBe(200);
  const jobId = (await res.json()).data.job.id as string;
  await waitFor(() => (db.prepare('SELECT status FROM txt_organize_jobs WHERE id = ?').get(jobId) as { status: string }).status === 'review', `任务 ${jobId} 进入 review`);
  return (db.prepare('SELECT result_book_id FROM txt_organize_jobs WHERE id = ?').get(jobId) as { result_book_id: string }).result_book_id;
}

describe('POST / GET /api/reader/:bookId/organize', () => {
  it('POST 发起后 GET 返回进行中的任务；读者看不到 notes', async () => {
    addBook('b1');
    mockUser = READER;
    let j = await (await api('/reader/b1/organize')).json();
    expect(j.data).toEqual({ available: true, job: null, lastRejectedAt: null });

    const res = await post('/reader/b1/organize');
    expect(res.status).toBe(200);
    j = await res.json();
    expect(j.data.job).toMatchObject({ book_id: 'b1', requested_by: 'u-reader' });
    expect(['pending', 'running', 'review']).toContain(j.data.job.status);

    await waitFor(() => (db.prepare("SELECT COUNT(*) AS n FROM txt_organize_jobs WHERE status = 'review'").get() as { n: number }).n === 1, '有一个 review 的整理任务');
    j = await (await api('/reader/b1/organize')).json();
    expect(j.data.available).toBe(true);
    expect(j.data.job).toMatchObject({ book_id: 'b1', status: 'review' });
    expect(j.data.job.notes).toBeUndefined();

    expect(j.data.job.requested_by).toBe('u-reader');

    // 别的读者看不到发起人
    mockUser = { userId: 'u-other', role: 'user' };
    j = await (await api('/reader/b1/organize')).json();
    expect(j.data.job).toMatchObject({ book_id: 'b1', status: 'review' });
    expect(j.data.job).not.toHaveProperty('requested_by');
    expect(j.data.job).not.toHaveProperty('notes');

    mockUser = ADMIN;
    j = await (await api('/reader/b1/organize')).json();
    expect(j.data.job.notes).toEqual(['第二章疑似缺字', '快速模式：规则判定 0 行，AI 判定 3 行']);
    expect(j.data.job.requested_by).toBe('u-reader');

    // 有拒绝记录时返回拒绝时间
    db.prepare("INSERT INTO txt_organize_rejections (book_id, file_size, rejected_at) VALUES ('b1', ?, '2026-11-20 01:02:03')")
      .run(fs.statSync(path.join(BOOKS, 'b1.txt')).size);
    j = await (await api('/reader/b1/organize')).json();
    expect(j.data.lastRejectedAt).toBe('2026-11-20 01:02:03');

    // 书不存在 → 404
    expect((await api('/reader/nope/organize')).status).toBe(404);
    expect((await post('/reader/nope/organize')).status).toBe(404);
  });

  it('mode：不带 body 缺省 fast；full 入库；非法值 422；GET 返回 mode', async () => {
    addBook('m1');
    addBook('m2');
    addBook('m3');
    let res = await api('/reader/m1/organize', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.job.mode).toBe('fast');

    res = await api('/reader/m2/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'full' }) });
    expect(res.status).toBe(200);
    expect((await res.json()).data.job.mode).toBe('full');
    expect((await (await api('/reader/m2/organize')).json()).data.job.mode).toBe('full');

    res = await api('/reader/m3/organize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'x' }) });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('VALIDATION_ERROR');
  });

  it('四种 OrganizeRequestError 返回 409 和对应文案', async () => {
    addBook('e1', 'epub');
    addBook('t1');
    const expect409 = async (id: string, message: string) => {
      const res = await post(`/reader/${id}/organize`);
      expect(res.status).toBe(409);
      const j = await res.json();
      expect(j.code).toBe('BUSINESS_CONFLICT');
      expect(j.message).toBe(message);
    };

    await expect409('e1', '只有 TXT 可以整理目录');
    expect((await (await api('/reader/e1/organize')).json()).data.available).toBe(false);

    mockAiConfigured = false;
    await expect409('t1', '管理员尚未配置 AI');
    expect((await (await api('/reader/t1/organize')).json()).data.available).toBe(false);
    mockAiConfigured = true;

    // 管理员在设置里关闭读者发起（值只能是 '0' / '1'）
    const put = (v: string) => api('/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ txt_organize_allow_readers: v }) });
    expect((await put('2')).status).toBe(422);
    expect((await put('0')).status).toBe(200);
    expect((await (await api('/settings')).json()).data.txt_organize_allow_readers).toBe('0');
    mockUser = READER;
    await expect409('t1', '管理员未开放此功能');
    expect((await (await api('/reader/t1/organize')).json()).data.available).toBe(false);
    mockUser = ADMIN;
    expect((await (await api('/reader/t1/organize')).json()).data.available).toBe(true);
    db.prepare("DELETE FROM settings WHERE key = 'txt_organize_allow_readers'").run();

    mockUser = READER;
    const ins = db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status) VALUES (?, 'other', 'u-reader', 'failed')");
    for (const id of ['x1', 'x2', 'x3']) ins.run(id);
    await expect409('t1', '今天的整理次数已用完，明天再试');
  });
});

describe('待审核的整理版', () => {
  it('pending_review 的整理版：书库列表不显示；管理员按 id 可以打开阅读（审核时预览）', async () => {
    const orgId = await makePendingOrganized('b1');
    const ids = async (q = '') => ((await (await api(`/library?pageSize=50${q}`)).json()).data as Array<{ id: string }>).map(b => b.id);

    mockUser = READER;
    expect(await ids()).toEqual(['b1']);
    expect(await ids('&status=all')).toEqual(['b1']);
    expect(await ids('&search=整理版')).toEqual([]);
    expect((await api(`/library/${orgId}`)).status).toBe(404);
    expect((await api(`/reader/${orgId}/chapters`)).status).toBe(404);
    expect((await api(`/reader/${orgId}/chapter/0`)).status).toBe(404);
    expect((await api(`/reader/${orgId}/raw`)).status).toBe(404);

    mockUser = ADMIN;
    expect(await ids()).toEqual(['b1']);
    expect((await api(`/library/${orgId}`)).status).toBe(200);
    const res = await api(`/reader/${orgId}/chapters`);
    expect(res.status).toBe(200);
    const titles = ((await res.json()).data.chapters as Array<{ title: string }>).map(c => c.title);
    expect(titles).toEqual(expect.arrayContaining(['第一章 开端', '第二章 发展', '第三章 结局']));
    const ch = await api(`/reader/${orgId}/chapter/1`);
    expect(ch.status).toBe(200);
    expect((await ch.json()).data.content).toContain('内容一。');

    // 书架、阅读历史、最近在读都不列出（即使有记录）
    for (const uid of ['u-reader', 'u-admin']) {
      db.prepare("INSERT INTO shelf (id, user_id, book_id) VALUES (?, ?, ?)").run(`s-${uid}`, uid, orgId);
      db.prepare("INSERT INTO reading_history (user_id, book_id, opened_at) VALUES (?, ?, '2099-01-01 00:00:00')").run(uid, orgId);
      db.prepare("INSERT INTO reading_progress (id, user_id, book_id, chapter_index, scroll_top) VALUES (?, ?, ?, 1, 0)").run(`p-${uid}`, uid, orgId);
    }
    for (const u of [READER, ADMIN]) {
      mockUser = u;
      expect((await (await api('/shelf')).json()).data).toEqual([]);
      expect((await (await api('/history')).json()).data).toEqual([]);
      expect((await (await api('/reader/last-read')).json()).data).toBeNull();
      const add = await api('/shelf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bookId: orgId }) });
      expect(add.status).toBe(404);
    }

    // OPDS 也不提供
    const dl = await fetch(`${base}/opds/books/${orgId}/download.epub`, { headers: { authorization: opdsAuth } });
    expect(dl.status).toBe(404);
  });
});

describe('整理版的文件路径', () => {
  it('整理版文件在 DATA_DIR/organized 下也能读章节；数据目录里其他文件（如 novel-reader.db）不能被当作书读', async () => {
    const orgId = await makePendingOrganized('b1');
    // 审核保留后：status normal，organized_from 仍指向原书
    db.prepare("UPDATE books SET status = 'normal' WHERE id = ?").run(orgId);
    mockUser = READER;
    expect((await api(`/reader/${orgId}/chapters`)).status).toBe(200);
    expect((await api(`/reader/${orgId}/raw`)).status).toBe(200);
    const dl = await fetch(`${base}/opds/books/${orgId}/download.epub`, { headers: { authorization: opdsAuth } });
    expect(dl.status).toBe(200);

    const dbFile = path.join(DATA, 'novel-reader.db');
    expect(fs.existsSync(dbFile)).toBe(true);
    const orgFile = path.join(ORGANIZED, `${orgId}.epub`);
    fs.symlinkSync(dbFile, path.join(ORGANIZED, 'link.txt'));
    const rows: Array<[string, string, string | null]> = [
      // 带 organized_from，但文件不在整理版目录里
      ['evil-db', dbFile, 'b1'],
      ['evil-dotdot', path.join(ORGANIZED, '..', 'novel-reader.db'), 'b1'],
      // 整理版目录里的符号链接指向数据库
      ['evil-link', path.join(ORGANIZED, 'link.txt'), 'b1'],
      // 没有 organized_from 的书不能读整理版目录
      ['evil-plain', orgFile, null],
    ];
    for (const [id, file, from] of rows) {
      db.prepare("INSERT INTO books (id, title, file_path, file_format, status, organized_from) VALUES (?, ?, ?, 'txt', 'normal', ?)")
        .run(id, id, file, from);
    }
    for (const [id] of rows) {
      for (const p of ['chapters', 'chapter/0', 'raw']) {
        expect([id, p, (await api(`/reader/${id}/${p}`)).status]).toEqual([id, p, 404]);
      }
      const r = await fetch(`${base}/opds/books/${id}/download.txt`, { headers: { authorization: opdsAuth } });
      expect([id, r.status]).toEqual([id, 404]);
    }
  });
});

describe('扫描与整理版', () => {
  it('有待审核的 organize 批次时仍可以开始扫描', async () => {
    await makePendingOrganized('b1');
    expect((db.prepare("SELECT COUNT(*) AS n FROM scan_batches WHERE kind = 'organize' AND status = 'pending'").get() as { n: number }).n).toBe(1);
    // 「扫描完成，有待审核的书」通知不算整理批次
    notifyScanReview(db);
    expect(db.prepare("SELECT 1 FROM notices WHERE kind = 'scan_review'").get()).toBeUndefined();
    const res = await post('/library/scan');
    expect(res.status).toBe(200);
    const taskId = (await res.json()).data.taskId as string;
    await waitFor(() => getScanTaskById(taskId)?.status !== 'running', `扫描任务 ${taskId} 结束`);

    // 普通扫描批次（kind 默认 'scan'）待审核时仍然拒绝
    db.prepare("DELETE FROM scan_batches WHERE kind = 'scan'").run();
    db.prepare("INSERT INTO scan_batches (id, task_id, status, summary_counts) VALUES ('sb1', ?, 'pending', '{}')").run(taskId);
    const again = await post('/library/scan');
    expect(again.status).toBe(409);
    expect((await again.json()).data.pendingBatchId).toBe('sb1');
  });

  it('扫描不会把整理版当孤儿删掉', async () => {
    const orgId = await makePendingOrganized('b1');
    const approvedId = await makePendingOrganized('b2');
    db.prepare("UPDATE books SET status = 'normal' WHERE id = ?").run(approvedId);
    const opts = { mode: 'auto', ai_fill: false, full_rescan: false };
    const task = createScanTask('u-admin', opts);
    await runScanTask(task.id, opts);
    expect(db.prepare('SELECT id FROM books WHERE id = ?').get(orgId)).toBeTruthy();
    expect(db.prepare('SELECT id FROM books WHERE id = ?').get(approvedId)).toBeTruthy();
    // 原书仍在
    expect(db.prepare("SELECT id FROM books WHERE id = 'b1'").get()).toBeTruthy();
  });
});

describe('原文件变化提示', () => {
  it('原文件变化后详情接口返回 organized_stale', async () => {
    const orgId = await makePendingOrganized('b1');
    const detail = async (id: string) => (await (await api(`/library/${id}`)).json()).data;
    // 刚整理完：不提示
    expect((await detail(orgId)).organized_stale).toBe(false);
    // 原书详情不带这个标记
    expect((await detail('b1')).organized_stale).toBeUndefined();
    // 原文件被改动：提示
    const file = (db.prepare("SELECT file_path FROM books WHERE id = 'b1'").get() as { file_path: string }).file_path;
    fs.appendFileSync(file, '\n新增的一行');
    expect((await detail(orgId)).organized_stale).toBe(true);
    // 原文件删除：不提示
    fs.rmSync(file);
    expect((await detail(orgId)).organized_stale).toBe(false);
  });
});
