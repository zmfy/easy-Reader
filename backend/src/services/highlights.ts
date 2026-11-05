import Database from 'better-sqlite3';
import crypto from 'crypto';
import { Highlight } from '../types';

// 建表 SQL：db.ts 初始化与测试共用
export const HIGHLIGHTS_DDL = `
  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
    text TEXT NOT NULL, note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_id);
`;

export interface NewHighlight {
  chapterIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  note?: string;
}

/** 某用户在某本书的全部划线，按阅读顺序（章节、偏移）排列 */
export function listHighlights(db: Database.Database, userId: string, bookId: string): Highlight[] {
  return db
    .prepare('SELECT * FROM highlights WHERE user_id = ? AND book_id = ? ORDER BY chapter_index, start_offset')
    .all(userId, bookId) as Highlight[];
}

export function createHighlight(db: Database.Database, userId: string, bookId: string, input: NewHighlight): Highlight {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO highlights (id, user_id, book_id, chapter_index, start_offset, end_offset, text, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, bookId, input.chapterIndex, input.startOffset, input.endOffset, input.text, input.note || null);
  return db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as Highlight;
}

/** 修改批注；空字符串清除批注。不存在或非本人的记录返回 null */
export function updateHighlightNote(
  db: Database.Database, userId: string, bookId: string, id: string, note: string | null
): Highlight | null {
  const r = db
    .prepare('UPDATE highlights SET note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND book_id = ?')
    .run(note || null, id, userId, bookId);
  if (r.changes === 0) return null;
  return db.prepare('SELECT * FROM highlights WHERE id = ?').get(id) as Highlight;
}

export function deleteHighlight(db: Database.Database, userId: string, bookId: string, id: string): boolean {
  const r = db.prepare('DELETE FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?').run(id, userId, bookId);
  return r.changes > 0;
}
