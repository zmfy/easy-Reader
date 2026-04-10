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

  // Migrations for existing databases
  try {
    database.exec('ALTER TABLE reading_progress ADD COLUMN chapter_title TEXT');
  } catch {
    // Column already exists, ignore
  }

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
