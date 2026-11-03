import Database from 'better-sqlite3';

// Tables holding per-book data keyed by book_id. manual_overrides (admin
// decisions) and audit_log (audit trail) are intentionally kept.
const BOOK_RELATION_TABLES = ['shelf', 'reading_progress', 'bookmarks', 'book_chapter_overrides', 'book_ai_metadata'];

// Tables holding per-user reading data keyed by user_id.
const USER_RELATION_TABLES = ['shelf', 'reading_progress', 'bookmarks'];

/** Delete all rows that reference the given books. Call inside the caller's transaction. */
export function deleteBookRelations(db: Database.Database, bookIds: string[]): void {
  if (bookIds.length === 0) return;
  const placeholders = bookIds.map(() => '?').join(',');
  for (const table of BOOK_RELATION_TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE book_id IN (${placeholders})`).run(...bookIds);
  }
}

/** Delete a user's personal reading data (shelf, progress, bookmarks, reader prefs). */
export function deleteUserData(db: Database.Database, userId: string): void {
  for (const table of USER_RELATION_TABLES) {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(`reader_prefs_${userId}`);
}
