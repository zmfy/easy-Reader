import fs from 'fs';
import os from 'os';
import path from 'path';
import type Database from 'better-sqlite3';

// 临时 DATA_DIR / BOOKS_DIR：必须在首次 require 源码之前设好
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-organize-job-'));
process.env.DATA_DIR = path.join(ROOT, 'data');
process.env.BOOKS_DIR = path.join(ROOT, 'books');
fs.mkdirSync(process.env.BOOKS_DIR, { recursive: true });
fs.mkdirSync(path.join(process.env.DATA_DIR, 'covers'), { recursive: true });

// AI：按提示词里的候选行打标签（「第…章」→ chapter，其余 → noise/text）；mockFail 时返回无法解析的内容
let mockAiConfigured = true;
let mockFail = false;
let mockChatCalls = 0;
jest.mock('../../../src/ai/ai-manager', () => ({
  isAiConfigured: () => mockAiConfigured,
  aiManager: {
    chat: async (prompt: string) => {
      mockChatCalls++;
      if (mockFail) return '不是 JSON';
      const labels = [...prompt.matchAll(/^#(\d+)\t([^\t]+)\t/gm)].map(m => (
        /^第.+章/.test(m[2])
          ? { id: Number(m[1]), type: 'chapter' }
          : { id: Number(m[1]), type: 'noise', noiseKind: 'text' }
      ));
      return JSON.stringify({ labels, notes: ['第二章疑似缺字'] });
    },
  },
}));

// 写出阶段强制失败（封面已复制之后的失败）
let mockWriteFail = false;
jest.mock('../../../src/services/txt-organize/writer', () => {
  const actual = jest.requireActual('../../../src/services/txt-organize/writer');
  return {
    ...actual,
    writeOrganizedEpub: (...args: unknown[]) =>
      mockWriteFail ? Promise.reject(new Error('整理结果与原文不一致')) : actual.writeOrganizedEpub(...args),
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
let db: Database.Database = require('../../../src/db').getDb();
let job = require('../../../src/services/txt-organize/job') as typeof import('../../../src/services/txt-organize/job');
/* eslint-enable @typescript-eslint/no-var-requires */

const { saveCoverFile } = require('../../../src/utils/cover') as typeof import('../../../src/utils/cover');
const BOOKS = process.env.BOOKS_DIR!;
const COVERS = path.join(process.env.DATA_DIR!, 'covers');
const ORGANIZED = path.join(process.env.DATA_DIR!, 'organized');
const ADMIN = { userId: 'u-admin', role: 'admin' as const };
const READER = { userId: 'u-reader', role: 'user' as const };

const TEXT = [
  '书名：测试书', '作者：某人', '',
  '第一章 开端', '　　内容一。', '', '第二章 发展', '内容二。', '第三回合他输了。', '第三章 结局', '内容三。',
].join('\n');

function addBook(id: string, opts: { format?: string; cover?: boolean } = {}): string {
  const format = opts.format ?? 'txt';
  const file = path.join(BOOKS, `${id}.${format}`);
  fs.writeFileSync(file, TEXT);
  let cover: string | null = null;
  if (opts.cover) {
    cover = `/covers/${id}-x.png`;
    fs.writeFileSync(path.join(process.env.DATA_DIR!, 'covers', `${id}-x.png`), Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  db.prepare(
    `INSERT INTO books (id, title, author, summary, category, cover_url, file_path, file_format, status, file_size)
     VALUES (?, '测试书', '某人', '简介', '玄幻', ?, ?, ?, 'normal', ?)`
  ).run(id, cover, file, format, fs.statSync(file).size);
  return file;
}

const getJob = (id: string) => db.prepare('SELECT * FROM txt_organize_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await new Promise(r => setTimeout(r, 10));
  expect(cond()).toBe(true);
}

/** 等所有任务跑完（不留后台任务影响下一个用例） */
const settle = () => waitFor(() =>
  (db.prepare("SELECT COUNT(*) AS n FROM txt_organize_jobs WHERE status IN ('pending', 'running')").get() as { n: number }).n === 0);

beforeAll(() => {
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u-admin', 'boss', 'x', 'admin')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u-reader', 'reader', 'x', 'user')").run();
});

beforeEach(() => {
  mockAiConfigured = true;
  mockFail = false;
  mockChatCalls = 0;
  mockWriteFail = false;
  db.exec(`
    DELETE FROM txt_organize_jobs; DELETE FROM txt_organize_chapter_map; DELETE FROM scan_batch_items;
    DELETE FROM scan_batches; DELETE FROM notices; DELETE FROM books;
    DELETE FROM settings WHERE key = 'txt_organize_allow_readers';
  `);
  fs.rmSync(ORGANIZED, { recursive: true, force: true });
});

afterEach(async () => { await settle(); });

it('成功：生成 pending_review 的整理版、organize 批次和审核项，任务进入 review', async () => {
  const src = addBook('b1', { cover: true });
  const created = job.requestOrganize('b1', READER);
  expect(created).toMatchObject({ book_id: 'b1', requested_by: 'u-reader', status: 'pending', notes: [] });

  await waitFor(() => getJob(created.id)?.status === 'review');
  const done = job.getActiveOrganizeJob('b1')!;
  expect(done).toMatchObject({
    id: created.id, status: 'review', batches_done: 1, batches_total: 1, candidate_count: 4, error: null,
  });
  expect(done.notes).toEqual(['第二章疑似缺字']);
  expect(getJob(created.id)).toMatchObject({ src_size: fs.statSync(src).size, src_mtime: fs.statSync(src).mtimeMs });
  expect(done.finished_at).toBeTruthy();

  const org = db.prepare('SELECT * FROM books WHERE organized_from = ?').get('b1') as Record<string, unknown>;
  expect(org).toMatchObject({
    id: done.result_book_id, title: '测试书（整理版）', author: '某人', summary: '简介', category: '玄幻',
    file_format: 'epub', status: 'pending_review', organized_job_id: created.id,
    chapter_count: 4,
  });
  expect(org.file_path).toBe(path.join(ORGANIZED, `${org.id}.epub`));
  // 封面是整理版自己的副本：原书换封面（删掉旧文件）后整理版的封面文件还在
  expect(org.cover_url).not.toBe('/covers/b1-x.png');
  expect(org.cover_url).toMatch(new RegExp(`^/covers/${org.id}-[^/]+\\.png$`));
  const orgCover = path.join(COVERS, (org.cover_url as string).slice('/covers/'.length));
  expect(fs.readFileSync(orgCover)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
  saveCoverFile('b1', Buffer.from('new'), 'jpg');
  expect(fs.existsSync(path.join(COVERS, 'b1-x.png'))).toBe(false);
  expect(fs.existsSync(orgCover)).toBe(true);
  expect(fs.existsSync(org.file_path as string)).toBe(true);
  // 书库文件夹里没有多出文件
  expect(fs.readdirSync(BOOKS)).toEqual(['b1.txt']);

  const map = db.prepare('SELECT chapter_index, src_start, src_end FROM txt_organize_chapter_map WHERE book_id = ? ORDER BY chapter_index').all(org.id);
  expect(map).toHaveLength(4);

  const batch = db.prepare("SELECT * FROM scan_batches WHERE kind = 'organize'").get() as Record<string, unknown>;
  expect(batch).toMatchObject({ task_id: created.id, status: 'pending' });
  const items = db.prepare('SELECT type, payload FROM scan_batch_items WHERE batch_id = ?').all(batch.id) as Array<{ type: string; payload: string }>;
  expect(items).toHaveLength(1);
  expect(items[0].type).toBe('organized_duplicate');
  const payload = JSON.parse(items[0].payload);
  expect(payload).toEqual({
    job_id: created.id,
    original: {
      // 现有规则把「第三回合他输了。」误切成一章
      book_id: 'b1', title: '测试书', file_path: src, chapter_count: 4,
      toc: [{ title: '第一章 开端', level: 0 }, { title: '第二章 发展', level: 0 }, { title: '第三回合他输了。', level: 0 }, { title: '第三章 结局', level: 0 }],
    },
    organized: {
      book_id: org.id, title: '测试书（整理版）', file_path: org.file_path, chapter_count: 4,
      toc: [{ title: '前言', level: 0 }, { title: '第一章 开端', level: 0 }, { title: '第二章 发展', level: 0 }, { title: '第三章 结局', level: 0 }],
    },
    notes: ['第二章疑似缺字'],
    batches: 1,
    candidate_count: 4,
    requested_by: { user_id: 'u-reader', username: 'reader' },
  });

  const notice = db.prepare("SELECT * FROM notices WHERE kind = 'txt_organize'").get() as Record<string, unknown>;
  expect(notice.link).toBe(`/library/scan-batches/${batch.id}`);
  expect(notice.title).toContain('测试书');
});

it('同一本书重复发起返回同一个任务', async () => {
  addBook('b2');
  const first = job.requestOrganize('b2', READER);
  const again = job.requestOrganize('b2', ADMIN);
  expect(again.id).toBe(first.id);
  await waitFor(() => getJob(first.id)?.status === 'review');
  // 待审核时也不新建
  expect(job.requestOrganize('b2', READER).id).toBe(first.id);
  expect(db.prepare('SELECT COUNT(*) AS n FROM txt_organize_jobs').get()).toEqual({ n: 1 });
});

it('非管理员第 4 次 → DAILY_LIMIT；管理员不限', async () => {
  const past = db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status, created_at) VALUES (?, 'x', ?, 'failed', ?)");
  for (let i = 0; i < 3; i++) {
    past.run(`r${i}`, 'u-reader', new Date().toISOString().slice(0, 19).replace('T', ' '));
    past.run(`a${i}`, 'u-admin', new Date().toISOString().slice(0, 19).replace('T', ' '));
  }
  // 前天的不算
  past.run('old', 'u-reader', '2000-01-01 00:00:00');
  addBook('b3');
  expect(() => job.requestOrganize('b3', READER)).toThrow(expect.objectContaining({ code: 'DAILY_LIMIT' }));
  expect(() => job.requestOrganize('b3', READER)).toThrow(job.OrganizeRequestError);
  expect(job.requestOrganize('b3', ADMIN).status).toBe('pending');
});

it('今天只发起过 2 次的读者还可以再发起', () => {
  const past = db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status) VALUES (?, 'x', 'u-reader', 'failed')");
  past.run('r0');
  past.run('r1');
  addBook('b3b');
  expect(job.requestOrganize('b3b', READER).status).toBe('pending');
});

it('设置关闭后读者发起 → READERS_DISABLED', () => {
  addBook('b4');
  db.prepare("INSERT INTO settings (key, value) VALUES ('txt_organize_allow_readers', '0')").run();
  expect(() => job.requestOrganize('b4', READER)).toThrow(expect.objectContaining({ code: 'READERS_DISABLED' }));
  expect(job.requestOrganize('b4', ADMIN).status).toBe('pending');
});

it('非 TXT → NOT_TXT', () => {
  addBook('b5', { format: 'epub' });
  expect(() => job.requestOrganize('b5', ADMIN)).toThrow(expect.objectContaining({ code: 'NOT_TXT' }));
});

it('未配置 AI → AI_NOT_CONFIGURED', () => {
  addBook('b6');
  mockAiConfigured = false;
  expect(() => job.requestOrganize('b6', ADMIN)).toThrow(expect.objectContaining({ code: 'AI_NOT_CONFIGURED' }));
});

it('AI 两次都失败 → 任务 failed，无新书、无批次、无文件', async () => {
  addBook('b7');
  mockFail = true;
  const created = job.requestOrganize('b7', READER);
  await waitFor(() => getJob(created.id)?.status === 'failed');
  expect(mockChatCalls).toBe(2);
  const failed = job.getActiveOrganizeJob('b7')!;
  expect(failed.status).toBe('failed');
  expect(failed.error).toContain('AI 判定失败');
  expect(failed.result_book_id).toBeNull();
  expect(db.prepare('SELECT COUNT(*) AS n FROM books').get()).toEqual({ n: 1 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM scan_batches').get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM scan_batch_items').get()).toEqual({ n: 0 });
  expect(db.prepare('SELECT COUNT(*) AS n FROM txt_organize_chapter_map').get()).toEqual({ n: 0 });
  expect(fs.existsSync(ORGANIZED) ? fs.readdirSync(ORGANIZED).filter(f => f.includes(created.id)) : []).toEqual([]);
  const notice = db.prepare("SELECT * FROM notices WHERE kind = 'txt_organize'").get() as Record<string, unknown>;
  expect(notice.link).toBeNull();
  expect(notice.title).toContain('测试书');
  // 失败后可以再发起（新任务）
  mockFail = false;
  expect(job.requestOrganize('b7', READER).id).not.toBe(created.id);
});

it('封面复制之后失败 → 删除复制的封面和文件', async () => {
  addBook('b11', { cover: true });
  mockWriteFail = true;
  const created = job.requestOrganize('b11', ADMIN);
  await waitFor(() => getJob(created.id)?.status === 'failed');
  expect(getJob(created.id)!.error).toBe('整理结果与原文不一致');
  expect(fs.readdirSync(COVERS).filter(f => f.startsWith(created.id))).toEqual([]);
  expect(fs.existsSync(path.join(COVERS, 'b11-x.png'))).toBe(true);
  expect(db.prepare('SELECT COUNT(*) AS n FROM books').get()).toEqual({ n: 1 });
});

it('远程封面地址原样沿用；本地封面文件缺失时不带封面', async () => {
  addBook('b12');
  addBook('b13');
  db.prepare("UPDATE books SET cover_url = 'https://img1.doubanio.com/view/subject/l/public/s1.jpg' WHERE id = 'b12'").run();
  db.prepare("UPDATE books SET cover_url = '/covers/b13-missing.png' WHERE id = 'b13'").run();
  const j12 = job.requestOrganize('b12', ADMIN);
  const j13 = job.requestOrganize('b13', ADMIN);
  await waitFor(() => getJob(j12.id)?.status === 'review' && getJob(j13.id)?.status === 'review');
  const coverOf = (id: string) => (db.prepare('SELECT cover_url FROM books WHERE organized_from = ?').get(id) as { cover_url: string | null }).cover_url;
  expect(coverOf('b12')).toBe('https://img1.doubanio.com/view/subject/l/public/s1.jpg');
  expect(coverOf('b13')).toBeNull();
});

it('原书在任务开始前被删除 → 任务 failed', async () => {
  addBook('b8');
  const created = job.requestOrganize('b8', ADMIN);
  db.prepare("DELETE FROM books WHERE id = 'b8'").run();
  await waitFor(() => getJob(created.id)?.status === 'failed');
  expect(getJob(created.id)!.error).toBe('原书已被删除');
  expect(db.prepare('SELECT COUNT(*) AS n FROM scan_batches').get()).toEqual({ n: 0 });
});

it('getLastRejection：文件大小与当前一致时才算', () => {
  const file = addBook('b9');
  const size = fs.statSync(file).size;
  expect(job.getLastRejection('b9')).toBeNull();
  db.prepare("INSERT INTO txt_organize_rejections (book_id, file_size, rejected_at) VALUES ('b9', ?, '2026-11-01 10:00:00')").run(size + 1);
  expect(job.getLastRejection('b9')).toBeNull();
  db.prepare("INSERT INTO txt_organize_rejections (book_id, file_size, rejected_at) VALUES ('b9', ?, '2026-11-02 10:00:00')").run(size);
  expect(job.getLastRejection('b9')).toEqual({ rejected_at: '2026-11-02 10:00:00' });
  db.prepare("DELETE FROM txt_organize_rejections WHERE book_id = 'b9'").run();
});

it('服务重启：running 任务回到 pending 后重跑只生成一份整理版', async () => {
  addBook('b10');
  // 重启前：任务跑到一半（running），留下了没写完的文件
  db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status, phase) VALUES ('j-restart', 'b10', 'u-admin', 'running', 'writing')").run();
  fs.mkdirSync(ORGANIZED, { recursive: true });
  fs.writeFileSync(path.join(ORGANIZED, 'j-restart.epub'), 'half');

  // 模拟重启：重新加载模块，db 初始化把 running 改回 pending，启动时 kick
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-var-requires */
  db = require('../../../src/db').getDb();
  job = require('../../../src/services/txt-organize/job');
  /* eslint-enable @typescript-eslint/no-var-requires */
  expect(getJob('j-restart')!.status).toBe('pending');
  job.kickOrganizeWorker();
  await waitFor(() => getJob('j-restart')?.status === 'review');

  expect(db.prepare("SELECT COUNT(*) AS n FROM books WHERE organized_from = 'b10'").get()).toEqual({ n: 1 });
  expect(db.prepare("SELECT COUNT(*) AS n FROM scan_batches WHERE task_id = 'j-restart'").get()).toEqual({ n: 1 });
  // 重跑覆盖了半成品，数据目录里只有一个整理版文件
  expect(fs.readdirSync(ORGANIZED)).toEqual(['j-restart.epub']);
  expect(fs.statSync(path.join(ORGANIZED, 'j-restart.epub')).size).toBeGreaterThan(100);
});
