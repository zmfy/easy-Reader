import Database from 'better-sqlite3';

/**
 * 阅读历史：进入阅读器即记一次（upsert 打开时间），按最近打开倒序列出，附上阅读进度供「继续阅读」。
 * 只记打开时间，与阅读进度分开：移除历史不影响进度和书架。
 */

export interface HistoryItem {
  book_id: string;
  opened_at: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  category: string | null;
  file_format: string;
  chapter_index: number | null;
  chapter_title: string | null;
  progress_updated_at: string | null;
}

/** 记一次打开；书不存在返回 false */
export function recordOpen(db: Database.Database, userId: string, bookId: string): boolean {
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId)) return false;
  // 精确到毫秒（同为 UTC、与 CURRENT_TIMESTAMP 同格式），连续打开几本时顺序也对
  db.prepare(
    `INSERT INTO reading_history (user_id, book_id, opened_at) VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
     ON CONFLICT(user_id, book_id) DO UPDATE SET opened_at = excluded.opened_at`
  ).run(userId, bookId);
  return true;
}

/** 最近打开的在前；已从书库删除的书不列出 */
export function listHistory(
  db: Database.Database, userId: string, page: number, pageSize: number,
): { items: HistoryItem[]; total: number } {
  const total = (db.prepare(
    'SELECT COUNT(*) AS n FROM reading_history h JOIN books b ON b.id = h.book_id WHERE h.user_id = ?'
  ).get(userId) as { n: number }).n;
  const items = db.prepare(
    `SELECT h.book_id, h.opened_at, b.title, b.author, b.cover_url, b.category, b.file_format,
            rp.chapter_index, rp.chapter_title, rp.updated_at AS progress_updated_at
     FROM reading_history h
     JOIN books b ON b.id = h.book_id
     LEFT JOIN reading_progress rp ON rp.user_id = h.user_id AND rp.book_id = h.book_id
     WHERE h.user_id = ?
     ORDER BY h.opened_at DESC, h.rowid DESC
     LIMIT ? OFFSET ?`
  ).all(userId, pageSize, (page - 1) * pageSize) as HistoryItem[];
  return { items, total };
}

export function removeHistory(db: Database.Database, userId: string, bookId: string): boolean {
  return db.prepare('DELETE FROM reading_history WHERE user_id = ? AND book_id = ?').run(userId, bookId).changes > 0;
}

export function clearHistory(db: Database.Database, userId: string): number {
  return db.prepare('DELETE FROM reading_history WHERE user_id = ?').run(userId).changes;
}
