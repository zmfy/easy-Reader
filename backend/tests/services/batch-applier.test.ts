import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { applyBatch } from '../../src/services/batch-applier';
import { _setDbForTesting } from '../../src/services/manual-override';

let db: Database.Database;
const TEST_DB = path.join(__dirname, '__test-batch-applier.db');

function setup(): void {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, file_path TEXT NOT NULL,
      file_format TEXT NOT NULL, file_size INTEGER, status TEXT DEFAULT 'normal',
      duplicate_of TEXT, series_id TEXT, chapter_count INTEGER, fingerprint TEXT,
      first_chapter_hash TEXT, encoding_detected TEXT, manually_edited_fields TEXT,
      imported_at DATETIME DEFAULT CURRENT_TIMESTAMP, is_finished INTEGER DEFAULT 0
    );
    CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT NOT NULL, summary TEXT, cover_url TEXT, author TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, applied_at DATETIME, applied_by TEXT, apply_summary TEXT);
    CREATE TABLE scan_batch_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, admin_decision TEXT, admin_payload TEXT, reviewed_at DATETIME, reviewed_by TEXT);
    CREATE TABLE manual_overrides (id TEXT PRIMARY KEY, type TEXT NOT NULL, book_id_a TEXT, book_id_b TEXT, series_id TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
  _setDbForTesting(db);
}

beforeEach(setup);
afterEach(() => {
  db?.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

function makeBatch(items: Array<{ type: string; payload: unknown }>): string {
  const batchId = uuidv4();
  db.prepare(`INSERT INTO scan_batches (id, task_id, status) VALUES (?, ?, 'pending')`).run(batchId, uuidv4());
  const ins = db.prepare(`INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, ?, ?)`);
  for (const it of items) ins.run(uuidv4(), batchId, it.type, JSON.stringify(it.payload));
  return batchId;
}

describe('applyBatch', () => {
  it('inserts new books', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/a', title: '三体', file_format: 'txt', file_size: 100, fingerprint: 'f1', status: 'normal' } },
    ]);
    const result = applyBatch(batchId, 'admin1', db);
    expect(result.inserted).toBe(1);
    const row = db.prepare('SELECT * FROM books WHERE file_path = ?').get('/a') as { title: string; fingerprint: string };
    expect(row.title).toBe('三体');
    expect(row.fingerprint).toBe('f1');
  });

  it('inserts canonical + duplicate books with duplicate_of link', () => {
    const batchId = makeBatch([
      {
        type: 'duplicate_group',
        payload: {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'f' },
            { file_path: '/y', fingerprint: 'f' },
          ],
        },
      },
    ]);
    applyBatch(batchId, 'admin1', db);
    const canonical = db.prepare("SELECT * FROM books WHERE file_path = '/x'").get() as { id: string; status: string; duplicate_of: string | null };
    const dup = db.prepare("SELECT * FROM books WHERE file_path = '/y'").get() as { status: string; duplicate_of: string };
    expect(canonical.status).toBe('normal');
    expect(canonical.duplicate_of).toBeNull();
    expect(dup.status).toBe('duplicate');
    expect(dup.duplicate_of).toBe(canonical.id);
  });

  it('creates series and assigns series_id to members', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/s1', title: '女生宿舍1', file_format: 'txt', file_size: 100, fingerprint: 'fs1', status: 'normal' } },
      { type: 'new', payload: { file_path: '/s2', title: '女生宿舍2', file_format: 'txt', file_size: 100, fingerprint: 'fs2', status: 'normal' } },
      {
        type: 'series',
        payload: {
          series_name: '女生宿舍',
          author: 'X',
          members: [{ file_path: '/s1', sequence: 1 }, { file_path: '/s2', sequence: 2 }],
          source: 'regex',
        },
      },
    ]);
    applyBatch(batchId, 'admin1', db);
    const series = db.prepare("SELECT * FROM series WHERE name = '女生宿舍'").get() as { id: string };
    expect(series).toBeTruthy();
    const s1 = db.prepare("SELECT * FROM books WHERE file_path = '/s1'").get() as { series_id: string };
    expect(s1.series_id).toBe(series.id);
  });

  it('garbled items are noop — books table is not modified', () => {
    const batchId = makeBatch([
      { type: 'garbled', payload: { file_path: '/g', reason: 'random bytes' } },
    ]);
    applyBatch(batchId, 'admin1', db);
    const row = db.prepare("SELECT * FROM books WHERE file_path = '/g'").get();
    expect(row).toBeUndefined(); // garbled does not INSERT
  });

  it('garbled items leave any pre-existing book row untouched', () => {
    // Pre-seed a book at the same file_path
    db.prepare(`INSERT INTO books (id, title, file_path, file_format, file_size, status) VALUES ('preexist', 'old', '/g', 'txt', 50, 'normal')`).run();
    const batchId = makeBatch([
      { type: 'garbled', payload: { file_path: '/g', reason: 'random bytes' } },
    ]);
    applyBatch(batchId, 'admin1', db);
    const row = db.prepare("SELECT * FROM books WHERE file_path = '/g'").get() as { status: string };
    expect(row.status).toBe('normal'); // preserved, not flipped to garbled
  });

  it('marks batch as applied and sets applied_by', () => {
    const batchId = makeBatch([
      { type: 'new', payload: { file_path: '/a', title: 'x', file_format: 'txt', file_size: 1, status: 'normal' } },
    ]);
    applyBatch(batchId, 'admin1', db);
    const batch = db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(batchId) as { status: string; applied_by: string; applied_at: string };
    expect(batch.status).toBe('applied');
    expect(batch.applied_by).toBe('admin1');
    expect(batch.applied_at).toBeTruthy();
  });

  it('records manual_overrides for rejected duplicate members', () => {
    const batchId = makeBatch([
      {
        type: 'duplicate_group',
        payload: {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'fx' },
            { file_path: '/y', fingerprint: 'fy' },
          ],
        },
      },
    ]);
    db.prepare(
      `UPDATE scan_batch_items SET admin_decision = 'modified', admin_payload = ? WHERE batch_id = ?`
    ).run(JSON.stringify({
      canonical_file_path: '/x',
      members: [{ file_path: '/x', fingerprint: 'fx' }],
      rejected_members: [{ file_path: '/y', fingerprint: 'fy' }],
    }), batchId);
    applyBatch(batchId, 'admin1', db);
    const y = db.prepare("SELECT * FROM books WHERE file_path = '/y'").get() as { status: string; duplicate_of: string | null };
    expect(y.status).toBe('normal');
    expect(y.duplicate_of).toBeNull();
    const ov = db.prepare("SELECT * FROM manual_overrides WHERE type = 'not_duplicate'").get();
    expect(ov).toBeTruthy();
  });
});
