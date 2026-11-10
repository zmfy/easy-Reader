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
