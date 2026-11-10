import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { backfillFingerprintVersion } from './services/scan-versions';
import { HIGHLIGHTS_DDL } from './services/highlights';
import { MIND_DDL, migrateMindTables } from './services/mind-nodes';
import { STUDY_SUMMARY_DDL, failStaleSummaryJobs } from './services/study-summary';
import { cleanBookTitle } from './utils/book-title';
import { DEFAULT_ADMIN_PASSWORD, markDefaultPasswordUsers } from './utils/password-policy';

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
    // 书库「书名 A→Z」按界面显示的清洗后书名排序（ORDER BY clean_title(title)）
    db.function('clean_title', { deterministic: true }, (title: unknown) =>
      typeof title === 'string' ? cleanBookTitle(title) : title);
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
  // Revocation counter: incremented on password change, invalidating every token issued before
  try { database.exec('ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 0'); } catch { /* column exists */ }
  // 仍在使用默认密码的账号必须先改密码；新增此列时，把已有库中密码仍是默认值的账号标记出来
  let addedMustChange = false;
  try {
    database.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0');
    addedMustChange = true;
  } catch { /* column exists */ }
  if (addedMustChange) markDefaultPasswordUsers(database);
  // Chapter-local reading anchor: block index + fraction within that block
  // (independent of font size / page width, unlike scroll_top pixels)
  for (const stmt of [
    'ALTER TABLE reading_progress ADD COLUMN paragraph_index INTEGER DEFAULT 0',
    'ALTER TABLE reading_progress ADD COLUMN paragraph_offset REAL DEFAULT 0',
  ]) {
    try { database.exec(stmt); } catch { /* column exists */ }
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
    "ALTER TABLE books ADD COLUMN file_mtime REAL",
    "ALTER TABLE books ADD COLUMN fingerprint_version INTEGER",
    "ALTER TABLE books ADD COLUMN ai_fill_version INTEGER",
    "ALTER TABLE books ADD COLUMN ai_fill_status TEXT",
    "ALTER TABLE books ADD COLUMN rating REAL",
  ];
  for (const stmt of booksAlters) {
    try { database.exec(stmt); } catch { /* column exists */ }
  }
  backfillFingerprintVersion(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_books_fingerprint ON books(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_books_file_path ON books(file_path);
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

  // === Plan 3 schema: book_chapter_overrides (F. AI 章节标题统一) ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS book_chapter_overrides (
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      normalized_title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (book_id, chapter_index)
    );
    CREATE INDEX IF NOT EXISTS idx_chapter_overrides_book ON book_chapter_overrides(book_id);
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
  // 改编作品（影视 / 广播剧）：JSON array of {type, title, year?, source, url}
  try { database.exec('ALTER TABLE book_ai_metadata ADD COLUMN adaptations TEXT'); } catch { /* column exists */ }

  // 后台 AI 丰富的待确认建议：每本书一条（最新的覆盖旧的），采纳或忽略后删除（见 services/ai-suggestions.ts）
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      book_id TEXT PRIMARY KEY,
      data TEXT NOT NULL,          -- JSON: { fields, recommended_tags?, similar_works?, adaptations? }
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // AI 判定正文与文件名不是同一本书：JSON { title, author?, reason?, dismissed? }
  try { database.exec('ALTER TABLE books ADD COLUMN content_mismatch TEXT'); } catch { /* column exists */ }
  // 建议按填充批次分组（每 500 本一批，见 services/ai-batch-fill.ts）；apply_job_id：已交给后台采纳任务、处理中
  try { database.exec('ALTER TABLE ai_suggestions ADD COLUMN batch_no INTEGER'); } catch { /* column exists */ }
  try { database.exec('ALTER TABLE ai_suggestions ADD COLUMN apply_job_id TEXT'); } catch { /* column exists */ }
  // 分批之前留下的建议：按生成时间每 500 条补一个批次号
  const unbatched = database.prepare(
    'SELECT book_id FROM ai_suggestions WHERE batch_no IS NULL ORDER BY created_at, book_id'
  ).all() as Array<{ book_id: string }>;
  if (unbatched.length > 0) {
    const seqRow = database.prepare("SELECT value FROM settings WHERE key = 'ai_fill_batch_seq'").get() as { value?: string } | undefined;
    let seq = parseInt(seqRow?.value ?? '0') || 0;
    const setBatch = database.prepare('UPDATE ai_suggestions SET batch_no = ? WHERE book_id = ?');
    database.transaction(() => {
      unbatched.forEach((r, i) => {
        if (i % 500 === 0) seq++;
        setBatch.run(seq, r.book_id);
      });
      database.prepare("INSERT INTO settings (key, value) VALUES ('ai_fill_batch_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(seq));
    })();
  }

  // 后台采纳任务（待确认页「全部采纳」）：items 为勾选结果 JSON；重启后 running 改回 pending 接着跑
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_apply_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',   -- pending / running / completed / failed
      batch_no INTEGER,
      total INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL,
      started_by TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      error TEXT
    );
  `);
  database.prepare("UPDATE ai_apply_jobs SET status = 'pending' WHERE status = 'running'").run();

  // 后台任务通知（铃铛）：填充每批完成 / 暂停 / 完成、采纳完成、扫描生成审核批次
  database.exec(`
    CREATE TABLE IF NOT EXISTS notices (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',   -- info / success / warning
      title TEXT NOT NULL,
      message TEXT,
      link TEXT,                            -- 前端路由，如 /library/ai-suggestions?batch=3
      action TEXT,                          -- 额外按钮，如 resume_fill（继续填充）
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_notices_created_at ON notices(created_at);
  `);

  // 扫描审核按每批最多 500 本拆分：同一次扫描的第几批 / 共几批
  try { database.exec('ALTER TABLE scan_batches ADD COLUMN part_index INTEGER'); } catch { /* column exists */ }
  try { database.exec('ALTER TABLE scan_batches ADD COLUMN part_count INTEGER'); } catch { /* column exists */ }

  // 多级分类上线前的单级旧分类一律进「待整理」（如旧的「历史」恰好与新的一级分类同名，但常是误判的古典小说）。
  // 只在第一次运行时记录一次；确认或改过分类后移出（见 services/category-migrate.ts）
  if (!database.prepare("SELECT 1 FROM settings WHERE key = 'category_review_ids'").get()) {
    const ids = (database.prepare(
      "SELECT id FROM books WHERE category IS NOT NULL AND TRIM(category) != '' AND instr(category, '/') = 0"
    ).all() as Array<{ id: string }>).map(r => r.id);
    database.prepare("INSERT INTO settings (key, value) VALUES ('category_review_ids', ?)").run(JSON.stringify(ids));
  }

  // === 阅读器 AI 前情提要缓存（按阅读位置） ===
  database.exec(`
    CREATE TABLE IF NOT EXISTS ai_recaps (
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      paragraph_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (book_id, chapter_index, paragraph_index)
    );
  `);

  // === 学习笔记：划线与批注 ===
  database.exec(HIGHLIGHTS_DDL);
  migrateMindTables(database);
  database.exec(MIND_DDL);
  database.exec(STUDY_SUMMARY_DDL);

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

  // 已审核：待确认页采纳 / 忽略、单本书页确认填充过的书，批量填充跳过；「重置全部填充记录」时清掉
  let reviewedAdded = false;
  try { database.exec('ALTER TABLE books ADD COLUMN ai_reviewed_at DATETIME'); reviewedAdded = true; } catch { /* column exists */ }
  if (reviewedAdded) {
    // 刚加列：按操作日志补记以前在待确认页采纳过的书（以前的「忽略」没有日志，补不上）
    database.exec(
      `UPDATE books SET ai_reviewed_at = (
         SELECT MAX(a.created_at) FROM audit_log a WHERE a.action = 'ai_suggestion_apply' AND a.resource_id = books.id)
       WHERE id IN (SELECT resource_id FROM audit_log WHERE action = 'ai_suggestion_apply')`
    );
  }

  // === Plan 1: recover stale running tasks on startup ===
  database.prepare(
    "UPDATE scan_tasks SET status = 'failed', error = ?, finished_at = CURRENT_TIMESTAMP WHERE status = 'running'"
  ).run('service restarted while task was running');
  failStaleSummaryJobs(database);

  // Insert default admin if not exists
  const adminExists = database.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!adminExists) {
    const bcrypt = require('bcryptjs');
    const { randomUUID: uuidv4 } = require('crypto');
    const hash = bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 10);
    database.prepare('INSERT INTO users (id, username, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)').run(
      uuidv4(), 'admin', hash, 'admin'
    );
  }
}

export default getDb;
