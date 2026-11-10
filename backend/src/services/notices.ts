import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getDb } from '../db';

/**
 * 后台任务通知（铃铛）：AI 填充每批完成 / 暂停 / 全部完成、后台采纳完成、扫描生成审核批次。
 * 只给管理员看；保留最近 MAX_NOTICES 条。
 */

export type NoticeLevel = 'info' | 'success' | 'warning';
export type NoticeAction = 'resume_fill';

export interface NoticeInput {
  kind: string;
  level?: NoticeLevel;
  title: string;
  message?: string;
  link?: string;
  action?: NoticeAction;
}

export interface Notice {
  id: string;
  kind: string;
  level: NoticeLevel;
  title: string;
  message: string | null;
  link: string | null;
  action: NoticeAction | null;
  created_at: string;
  read_at: string | null;
}

const MAX_NOTICES = 100;

export function addNotice(input: NoticeInput, db: Database.Database = getDb()): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO notices (id, kind, level, title, message, link, action) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.kind, input.level ?? 'info', input.title, input.message ?? null, input.link ?? null, input.action ?? null);
  db.prepare(
    `DELETE FROM notices WHERE rowid NOT IN (SELECT rowid FROM notices ORDER BY rowid DESC LIMIT ?)`
  ).run(MAX_NOTICES);
  return id;
}

export function listNotices(db: Database.Database = getDb(), limit = 30): { items: Notice[]; unread: number } {
  reconcilePendingNotices(db);
  const items = db.prepare('SELECT * FROM notices ORDER BY rowid DESC LIMIT ?').all(limit) as Notice[];
  const unread = (db.prepare('SELECT COUNT(*) AS n FROM notices WHERE read_at IS NULL').get() as { n: number }).n;
  return { items, unread };
}

export function markNoticeRead(id: string, db: Database.Database = getDb()): boolean {
  return db.prepare('UPDATE notices SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND read_at IS NULL').run(id).changes > 0;
}

export function markAllNoticesRead(db: Database.Database = getDb()): number {
  return db.prepare('UPDATE notices SET read_at = CURRENT_TIMESTAMP WHERE read_at IS NULL').run().changes;
}

/*
 * 「待确认 / 待审核」提醒：同类还没处理完时，新一批合并进同一条（不另发）；
 * 处理完后自动消失。每次列通知时按书库现状校正（标题里的批次范围、本数随确认进度更新）。
 */

interface PendingFill { count: number; first: number | null; last: number | null }

function pendingFill(db: Database.Database): PendingFill {
  return db.prepare(
    `SELECT COUNT(*) AS count, MIN(s.batch_no) AS first, MAX(s.batch_no) AS last
     FROM ai_suggestions s JOIN books b ON b.id = s.book_id
     WHERE b.status = 'normal' AND s.apply_job_id IS NULL`
  ).get() as PendingFill;
}

function fillPendingTitle(p: PendingFill): string {
  const range = p.first == null ? '' : p.first === p.last ? `第 ${p.first} 批` : `第 ${p.first}–${p.last} 批`;
  return `AI 填充${range}有 ${p.count} 本待确认`;
}

function scanPendingMessage(db: Database.Database): { batches: number; books: number } {
  const rows = db.prepare("SELECT summary_counts FROM scan_batches WHERE status = 'pending'").all() as Array<{ summary_counts: string | null }>;
  let books = 0;
  for (const r of rows) {
    try { books += JSON.parse(r.summary_counts ?? '{}').new ?? 0; } catch { /* 忽略 */ }
  }
  return { batches: rows.length, books };
}

function scanPendingText(s: { batches: number; books: number }): string {
  return s.batches > 1 ? `共 ${s.batches} 批待审核，新书 ${s.books} 本，可逐批审核` : `新书 ${s.books} 本，请审核后入库`;
}

/**
 * AI 填充一批完成。有待确认的书时，与之前未确认的合并成一条「去确认」；
 * 这一批没有要确认的、之前也都确认完了，就只发一条普通完成通知。
 */
export function notifyFillBatch(batchLine: string, level: NoticeLevel, db: Database.Database = getDb()): void {
  const p = pendingFill(db);
  if (p.count === 0) {
    addNotice({ kind: 'ai_fill_batch', level, title: 'AI 填充一批完成', message: batchLine }, db);
    return;
  }
  db.prepare("DELETE FROM notices WHERE kind = 'ai_fill_batch' AND link IS NOT NULL").run();
  addNotice({
    kind: 'ai_fill_batch', level, title: fillPendingTitle(p),
    message: `最近完成${batchLine}`, link: '/library/ai-suggestions',
  }, db);
}

/** 扫描生成了待审核批次：与之前未审核的合并成一条 */
export function notifyScanReview(db: Database.Database = getDb()): void {
  const s = scanPendingMessage(db);
  db.prepare("DELETE FROM notices WHERE kind = 'scan_review'").run();
  if (s.batches === 0) return;
  addNotice({
    kind: 'scan_review', level: 'info', title: '扫描完成，有待审核的书',
    message: scanPendingText(s), link: '/library/scan-batches',
  }, db);
}

/** 按现状校正待处理类提醒：处理完的删掉，没处理完的更新本数 */
export function reconcilePendingNotices(db: Database.Database = getDb()): void {
  const p = pendingFill(db);
  if (p.count === 0) {
    db.prepare("DELETE FROM notices WHERE kind = 'ai_fill_batch' AND link IS NOT NULL").run();
    db.prepare("UPDATE notices SET link = NULL WHERE kind IN ('ai_apply_done', 'ai_fill_done') AND link IS NOT NULL").run();
  } else {
    // 只留最新一条（旧版每批一条的提醒也收拢成一条）
    db.prepare(
      `DELETE FROM notices WHERE kind = 'ai_fill_batch' AND link IS NOT NULL AND rowid <
         (SELECT MAX(rowid) FROM notices WHERE kind = 'ai_fill_batch' AND link IS NOT NULL)`
    ).run();
    db.prepare("UPDATE notices SET title = ?, link = '/library/ai-suggestions' WHERE kind = 'ai_fill_batch' AND link IS NOT NULL").run(fillPendingTitle(p));
  }
  const s = scanPendingMessage(db);
  if (s.batches === 0) db.prepare("DELETE FROM notices WHERE kind = 'scan_review'").run();
  else db.prepare("UPDATE notices SET message = ? WHERE kind = 'scan_review'").run(scanPendingText(s));
}
