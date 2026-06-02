import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'novel-reader.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const database = db;

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by TEXT,
      used_by TEXT,
      used_at DATETIME,
      expires_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      file_path TEXT NOT NULL,
      file_format TEXT NOT NULL,
      cover_url TEXT,
      summary TEXT,
      category TEXT,
      tags TEXT,
      publish_date TEXT,
      finish_date TEXT,
      is_finished INTEGER DEFAULT 0,
      file_size INTEGER,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS shelf (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_read_at DATETIME,
      UNIQUE(user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_index INTEGER DEFAULT 0,
      chapter_title TEXT,
      scroll_top INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      scroll_top INTEGER DEFAULT 0,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS uq_shelf_user_book ON shelf(user_id, book_id);
    CREATE INDEX IF NOT EXISTS uq_progress_user_book ON reading_progress(user_id, book_id);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id);
    CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);
    CREATE INDEX IF NOT EXISTS idx_books_author ON books(author);
    CREATE INDEX IF NOT EXISTS idx_books_imported_at ON books(imported_at);
  `);

  // === Migrations for existing databases ===
  try {
    database.exec('ALTER TABLE reading_progress ADD COLUMN chapter_title TEXT');
  } catch {
    /* column exists */
  }

  // === Plan 1 schema: scan_tasks ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      stage TEXT,
      total_files INTEGER DEFAULT 0,
      processed_files INTEGER DEFAULT 0,
      options TEXT,
      started_by TEXT NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_tasks_status ON scan_tasks(status);
  `);

  // === Plan 1 schema: books extra columns ===
  const booksAlters: string[] = [
    "ALTER TABLE books ADD COLUMN status TEXT DEFAULT 'normal'",
    "ALTER TABLE books ADD COLUMN duplicate_of TEXT",
    "ALTER TABLE books ADD COLUMN series_id TEXT",
    "ALTER TABLE books ADD COLUMN chapter_count INTEGER",
    "ALTER TABLE books ADD COLUMN fingerprint TEXT",
    "ALTER TABLE books ADD COLUMN first_chapter_hash TEXT",
    "ALTER TABLE books ADD COLUMN encoding_detected TEXT",
    "ALTER TABLE books ADD COLUMN manually_edited_fields TEXT",
  ];
  for (const stmt of booksAlters) {
    try { database.exec(stmt); } catch { /* column exists */ }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_fingerprint ON books(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_books_duplicate_of ON books(duplicate_of);
    CREATE INDEX IF NOT EXISTS idx_books_series_id ON books(series_id);
    CREATE INDEX IF NOT EXISTS idx_books_status ON books(status);
  `);

  // === Plan 2 schema: series ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT,
      cover_url TEXT,
      author TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_series_name ON series(name);
  `);

  // === Plan 2 schema: scan_batches ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_batches (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      summary_counts TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      applied_at DATETIME,
      applied_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_batches_status ON scan_batches(status);
  `);
  // Plan 2 fix: audit trail of what apply actually did
  try { database.exec("ALTER TABLE scan_batches ADD COLUMN apply_summary TEXT"); } catch { /* exists */ }

  // === Plan 2 schema: scan_batch_items ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS scan_batch_items (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      admin_decision TEXT,
      admin_payload TEXT,
      reviewed_at DATETIME,
      reviewed_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scan_batch_items_batch ON scan_batch_items(batch_id);
    CREATE INDEX IF NOT EXISTS idx_scan_batch_items_type ON scan_batch_items(type);
  `);

  // === Plan 2 schema: manual_overrides ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS manual_overrides (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      book_id_a TEXT,
      book_id_b TEXT,
      series_id TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_manual_overrides_type ON manual_overrides(type);
    CREATE INDEX IF NOT EXISTS idx_manual_overrides_book_a ON manual_overrides(book_id_a);
  `);

  // === Plan 3 schema: book_ai_metadata (E. AI 推荐标签 + 相似作品) ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS book_ai_metadata (
      book_id TEXT PRIMARY KEY,
      recommended_tags TEXT,   -- JSON array of strings
      similar_works TEXT,      -- JSON array of {title, author?, reason?}
      generated_by TEXT,       -- plugin name (deepseek / minmax / ...)
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // === Plan 3 schema: audit_log ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_id TEXT,
      file_path TEXT,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
  `);

  // === Plan 1: recover stale running tasks on startup ===
  database.prepare(
    "UPDATE scan_tasks SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status = 'running'"
  ).run('service restarted while task was running');

  // Insert default admin if not exists
  const adminExists = database.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    const hash = bcrypt.hashSync('admin123', 10);
    database.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
      uuidv4(), 'admin', hash, 'admin'
    );
  }
}

export default getDb;
