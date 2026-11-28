import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDb } from '../../db';
import { isAiConfigured } from '../../ai/ai-manager';
import { TxtParser } from '../../plugins/parser-txt';
import { resolveRealPathInsideRoot } from '../../utils/path-safe';
import { removeCoverFiles, saveCoverFile } from '../../utils/cover';
import { readCover } from '../opds-download';
import { notifyOrganizeResult } from '../notices';
import { collectCandidates } from './candidates';
import { judgeCandidates, type OrganizeMode } from './judge';
import { buildStructure } from './structure';
import { organizedDir, writeOrganizedEpub } from './writer';

/**
 * TXT 目录 AI 整理的后台任务：读者 / 管理员发起，一次只跑一个任务、其余排队（写法同 ai-apply-job）。
 * 挑候选行 → AI 判定 → 写整理版 EPUB（逐字校验）→ 一个事务里入库整理版、写章节对照表、生成审核批次。
 * 任何一步失败：任务 failed，删除生成的文件，不留任何书 / 批次。
 * 重启后 running 的任务由 db.ts 改回 pending 重跑；整理版书籍 id 就用任务 id，重跑覆盖半成品文件、不会多出一份。
 */

const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
/** 非管理员每人每天最多发起次数 */
export const ORGANIZE_DAILY_LIMIT = 3;
const ORGANIZED_SUFFIX = '（整理版）';

export type OrganizeJobStatus = 'pending' | 'running' | 'review' | 'failed' | 'done';
export type OrganizePhase = 'candidates' | 'judging' | 'writing';

export interface OrganizeJob {
  id: string;
  book_id: string;
  requested_by: string;
  status: OrganizeJobStatus;
  mode: OrganizeMode;
  phase: OrganizePhase | null;
  batches_done: number;
  batches_total: number;
  candidate_count: number;
  notes: string[];
  result_book_id: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** 审核项 organized_duplicate 的 payload */
export interface OrganizedDuplicatePayload {
  job_id: string;
  /** 整理模式；旧 payload 没有这个字段 */
  mode?: OrganizeMode;
  original: { book_id: string; title: string; file_path: string; chapter_count: number; toc: Array<{ title: string; level: number }> };
  organized: { book_id: string; title: string; file_path: string; chapter_count: number; toc: Array<{ title: string; level: number }> };
  notes: string[];
  batches: number;
  candidate_count: number;
  requested_by: { user_id: string; username: string };
}

export type OrganizeRequestErrorCode = 'NOT_TXT' | 'AI_NOT_CONFIGURED' | 'READERS_DISABLED' | 'DAILY_LIMIT';

const REQUEST_ERROR_MESSAGES: Record<OrganizeRequestErrorCode, string> = {
  NOT_TXT: '只能整理 TXT 格式的书',
  AI_NOT_CONFIGURED: '未配置 AI 插件，请先在「AI 插件设置」中配置',
  READERS_DISABLED: '管理员未开放读者发起 AI 整理目录',
  DAILY_LIMIT: `每人每天最多发起 ${ORGANIZE_DAILY_LIMIT} 次 AI 整理目录，请明天再试`,
};

export class OrganizeRequestError extends Error {
  constructor(public code: OrganizeRequestErrorCode) {
    super(REQUEST_ERROR_MESSAGES[code]);
    this.name = 'OrganizeRequestError';
  }
}

const JOB_COLUMNS = 'id, book_id, requested_by, status, mode, phase, batches_done, batches_total, candidate_count, notes, result_book_id, error, created_at, finished_at';

type JobRow = Omit<OrganizeJob, 'notes'> & { notes: string | null };

function toJob(row: JobRow): OrganizeJob {
  let notes: string[] = [];
  try { notes = row.notes ? JSON.parse(row.notes) : []; } catch { /* 忽略 */ }
  return { ...row, notes };
}

function getJob(id: string, db: Database.Database): OrganizeJob | null {
  const row = db.prepare(`SELECT ${JOB_COLUMNS} FROM txt_organize_jobs WHERE id = ?`).get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/** 这本书进行中或待审核的任务 */
function findOpenJob(bookId: string, db: Database.Database): OrganizeJob | null {
  const row = db.prepare(
    `SELECT ${JOB_COLUMNS} FROM txt_organize_jobs WHERE book_id = ? AND status IN ('pending', 'running', 'review')
     ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(bookId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/**
 * 发起整理。这本书已有进行中 / 待审核的任务时直接返回它；否则校验限制后新建并启动 worker。
 * 书不存在时抛普通 Error（路由层应先确认书存在）。
 */
export function requestOrganize(
  bookId: string,
  user: { userId: string; role: 'admin' | 'user' },
  db: Database.Database = getDb(),
  mode: OrganizeMode = 'fast',
): OrganizeJob {
  const open = findOpenJob(bookId, db);
  if (open) return open;

  const book = db.prepare('SELECT file_format FROM books WHERE id = ?').get(bookId) as { file_format: string } | undefined;
  if (!book) throw new Error('书籍不存在');
  if (book.file_format.toLowerCase() !== 'txt') throw new OrganizeRequestError('NOT_TXT');
  if (!isAiConfigured(db)) throw new OrganizeRequestError('AI_NOT_CONFIGURED');
  if (user.role !== 'admin') {
    const allow = db.prepare("SELECT value FROM settings WHERE key = 'txt_organize_allow_readers'").get() as { value: string } | undefined;
    if (allow?.value === '0') throw new OrganizeRequestError('READERS_DISABLED');
    // created_at 是 UTC（CURRENT_TIMESTAMP）：把本地今天 00:00 换成 UTC 再比
    const { n } = db.prepare(
      "SELECT COUNT(*) AS n FROM txt_organize_jobs WHERE requested_by = ? AND created_at >= datetime(date('now', 'localtime'), 'utc')"
    ).get(user.userId) as { n: number };
    if (n >= ORGANIZE_DAILY_LIMIT) throw new OrganizeRequestError('DAILY_LIMIT');
  }

  const id = randomUUID();
  db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status, mode) VALUES (?, ?, ?, 'pending', ?)").run(id, bookId, user.userId, mode);
  kickOrganizeWorker();
  return getJob(id, db)!;
}

/** 这本书最近一个任务（已完成审核的 done 不算，返回 null）；failed 也返回，供前端显示失败原因 */
export function getActiveOrganizeJob(bookId: string, db: Database.Database = getDb()): OrganizeJob | null {
  const row = db.prepare(
    `SELECT ${JOB_COLUMNS} FROM txt_organize_jobs WHERE book_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
  ).get(bookId) as JobRow | undefined;
  return row && row.status !== 'done' ? toJob(row) : null;
}

/** 这本书当前版本（文件大小一致）被拒绝过的整理；文件读不到时用书库记录的大小 */
export function getLastRejection(bookId: string, db: Database.Database = getDb()): { rejected_at: string } | null {
  const book = db.prepare('SELECT file_path, file_size FROM books WHERE id = ?').get(bookId) as { file_path: string; file_size: number | null } | undefined;
  if (!book) return null;
  let size = book.file_size;
  try { size = fs.statSync(book.file_path).size; } catch { /* 用记录的大小 */ }
  if (size == null) return null;
  const row = db.prepare(
    'SELECT rejected_at FROM txt_organize_rejections WHERE book_id = ? AND file_size = ? ORDER BY rejected_at DESC LIMIT 1'
  ).get(bookId, size) as { rejected_at: string } | undefined;
  return row ?? null;
}

let workerRunning = false;

/** 启动 worker（已在跑则什么都不做）；服务启动时也调用一次，接着跑重启前没跑完的任务 */
export function kickOrganizeWorker(): void {
  if (workerRunning) return;
  workerRunning = true;
  setImmediate(() => {
    runWorker()
      .catch(err => { console.error('[txt-organize] worker 异常退出:', err); })
      .finally(() => { workerRunning = false; });
  });
}

async function runWorker(): Promise<void> {
  const db = getDb();
  for (;;) {
    const job = db.prepare(
      "SELECT id, book_id, requested_by, mode FROM txt_organize_jobs WHERE status = 'pending' ORDER BY created_at, rowid LIMIT 1"
    ).get() as { id: string; book_id: string; requested_by: string; mode: OrganizeMode } | undefined;
    if (!job) return;
    db.prepare("UPDATE txt_organize_jobs SET status = 'running', phase = NULL, error = NULL WHERE id = ?").run(job.id);
    const title = (db.prepare('SELECT title FROM books WHERE id = ?').get(job.book_id) as { title: string } | undefined)?.title ?? '已删除的书';
    let batchId: string;
    try {
      batchId = await runJob(job, db);
    } catch (err) {
      // 先把任务标成 failed，后面的清理 / 通知出错也不会让任务一直停在 running
      const message = (err instanceof Error && err.message) || String(err);
      db.prepare("UPDATE txt_organize_jobs SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(message, job.id);
      // 整理版文件和封面副本都以任务 id 命名：失败时删掉（写出阶段之后失败也不会留下）
      try {
        fs.rmSync(organizedFilePath(job.id), { force: true });
      } catch (e) {
        console.warn(`[txt-organize ${job.id}] 删除整理版文件失败:`, e instanceof Error ? e.message : e);
      }
      try {
        removeCoverFiles(job.id);
      } catch (e) {
        console.warn(`[txt-organize ${job.id}] 删除封面副本失败:`, e instanceof Error ? e.message : e);
      }
      try {
        notifyOrganizeResult({ book_title: title, error: message }, 'failed', db);
      } catch (e) {
        console.warn(`[txt-organize ${job.id}] 发送失败通知出错:`, e instanceof Error ? e.message : e);
      }
      continue;
    }
    // 放在 try 外：入库已提交后发通知出错，不能把任务改成失败、删掉文件
    try {
      notifyOrganizeResult({ book_title: title, batch_id: batchId }, 'review', db);
    } catch (e) {
      console.warn(`[txt-organize ${job.id}] 发送审核通知出错:`, e instanceof Error ? e.message : e);
    }
  }
}

function organizedFilePath(bookId: string): string {
  return path.join(organizedDir(), `${bookId}.epub`);
}

const COVER_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/**
 * 整理版的封面：原书是本地封面文件时复制一份给整理版（原书以后换封面会删掉旧文件），同一份数据嵌进 EPUB；
 * 远程地址原样沿用（没有文件可复制）；本地文件缺失或复制失败时不带封面，不让任务失败。
 */
function copyCover(coverUrl: string | null, newBookId: string): {
  coverUrl: string | null;
  cover: { buffer: Buffer; mimeType: string } | null;
} {
  if (!coverUrl) return { coverUrl: null, cover: null };
  if (!coverUrl.startsWith('/covers/')) return { coverUrl, cover: null };
  try {
    const local = readCover(coverUrl);
    if (!local) return { coverUrl: null, cover: null };
    const url = saveCoverFile(newBookId, local.data, COVER_EXT[local.mimeType] ?? 'jpg');
    return { coverUrl: url, cover: { buffer: local.data, mimeType: local.mimeType } };
  } catch (err) {
    console.warn(`[txt-organize ${newBookId}] 复制封面失败，整理版不带封面:`, err instanceof Error ? err.message : err);
    return { coverUrl: null, cover: null };
  }
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  summary: string | null;
  category: string | null;
  cover_url: string | null;
  file_path: string;
}

/** 跑一个任务，成功时返回审核批次 id；失败抛错 */
async function runJob(job: { id: string; book_id: string; requested_by: string; mode: OrganizeMode }, db: Database.Database): Promise<string> {
  const loadBook = () => db.prepare(
    'SELECT id, title, author, summary, category, cover_url, file_path FROM books WHERE id = ?'
  ).get(job.book_id) as BookRow | undefined;
  const book = loadBook();
  if (!book) throw new Error('原书已被删除');
  const srcPath = resolveRealPathInsideRoot(BOOKS_DIR, book.file_path);
  if (!srcPath) throw new Error('原文件不存在');
  const stat = fs.statSync(srcPath);
  const setPhase = db.prepare('UPDATE txt_organize_jobs SET phase = ? WHERE id = ?');
  db.prepare('UPDATE txt_organize_jobs SET src_size = ?, src_mtime = ?, phase = ? WHERE id = ?')
    .run(stat.size, stat.mtimeMs, 'candidates', job.id);

  // 1. 候选行；原书目录（审核页对比用）取自同一次解析
  const parser = new TxtParser();
  await parser.load(srcPath);
  const originalToc = (await parser.getChapters()).map(c => ({ title: c.title, level: c.level ?? 0 }));
  const { candidates } = await collectCandidates(srcPath, parser);
  db.prepare('UPDATE txt_organize_jobs SET candidate_count = ?, phase = ? WHERE id = ?').run(candidates.length, 'judging', job.id);

  // 2. AI 判定
  const progress = db.prepare('UPDATE txt_organize_jobs SET batches_done = ?, batches_total = ? WHERE id = ?');
  const judged = await judgeCandidates(candidates, { title: book.title, author: book.author }, db,
    (done, total) => { progress.run(done, total, job.id); }, job.mode);
  const structure = buildStructure(candidates, judged.labels, stat.size);
  const notes = [...judged.notes, ...structure.notes];
  setPhase.run('writing', job.id);

  // 3. 写整理版 EPUB（逐字校验不一致时 writer 自己删文件并抛错）
  const newBookId = job.id;
  const newTitle = book.title + ORGANIZED_SUFFIX;
  const { coverUrl, cover } = copyCover(book.cover_url, newBookId);
  const { filePath, chapterMap } = await writeOrganizedEpub({
    newBookId, sourcePath: srcPath, structure, title: newTitle, author: book.author, summary: book.summary, cover,
  });
  // 整理期间原文件被改过：对照表和逐字校验都对不上新文件，不能生成审核
  let after: fs.Stats | null = null;
  try { after = fs.statSync(srcPath); } catch { /* 被删掉也算修改 */ }
  if (!after || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
    throw new Error('原文件在整理期间被修改，请重新发起整理');
  }
  // 有前言时 chapterMap 比 sections 多一章（第 0 章）
  const organizedToc = [
    ...(chapterMap.length > structure.sections.length ? [{ title: '前言', level: 0 }] : []),
    ...structure.sections.map(s => ({ title: s.title, level: s.level as number })),
  ];

  // 4. 一个事务里入库整理版、对照表、审核批次，任务进入 review
  const batchId = randomUUID();
  db.transaction(() => {
    // 写出期间原书被删了：不生成审核
    const current = loadBook();
    if (!current) throw new Error('原书已被删除');
    const username = (db.prepare('SELECT username FROM users WHERE id = ?').get(job.requested_by) as { username: string } | undefined)?.username ?? '';
    db.prepare(
      `INSERT INTO books (id, title, author, summary, category, cover_url, file_path, file_format, status, file_size, chapter_count, organized_from, organized_job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'epub', 'pending_review', ?, ?, ?, ?)`
    ).run(newBookId, newTitle, current.author, current.summary, current.category, coverUrl, filePath,
      fs.statSync(filePath).size, chapterMap.length, current.id, job.id);
    const insertMap = db.prepare('INSERT INTO txt_organize_chapter_map (book_id, chapter_index, src_start, src_end) VALUES (?, ?, ?, ?)');
    for (const m of chapterMap) insertMap.run(newBookId, m.chapterIndex, m.srcStart, m.srcEnd);

    const payload: OrganizedDuplicatePayload = {
      job_id: job.id,
      mode: job.mode,
      original: { book_id: current.id, title: current.title, file_path: current.file_path, chapter_count: originalToc.length, toc: originalToc },
      organized: { book_id: newBookId, title: newTitle, file_path: filePath, chapter_count: organizedToc.length, toc: organizedToc },
      notes,
      batches: judged.batches,
      candidate_count: candidates.length,
      requested_by: { user_id: job.requested_by, username },
    };
    db.prepare(
      `INSERT INTO scan_batches (id, task_id, status, summary_counts, kind) VALUES (?, ?, 'pending', ?, 'organize')`
    ).run(batchId, job.id, JSON.stringify({ organized_duplicate: 1 }));
    db.prepare(
      `INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, 'organized_duplicate', ?)`
    ).run(randomUUID(), batchId, JSON.stringify(payload));
    db.prepare(
      `UPDATE txt_organize_jobs SET status = 'review', phase = NULL, notes = ?, result_book_id = ?, error = NULL, finished_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(JSON.stringify(notes), newBookId, job.id);
  })();
  return batchId;
}
