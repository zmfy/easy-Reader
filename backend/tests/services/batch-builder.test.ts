import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { buildBatchFromScan, ScanResult } from '../../src/services/batch-builder';

let db: Database.Database;
const TEST_DB = path.join(__dirname, '__test-batch-builder.db');

function setup(): void {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, applied_at DATETIME, applied_by TEXT);
    CREATE TABLE scan_batch_items (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, admin_decision TEXT, admin_payload TEXT, reviewed_at DATETIME, reviewed_by TEXT);
    CREATE TABLE manual_overrides (id TEXT PRIMARY KEY, type TEXT NOT NULL, book_id_a TEXT, book_id_b TEXT, series_id TEXT, created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  `);
}

afterEach(() => {
  db?.close();
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
});

beforeEach(() => {
  setup();
});

describe('buildBatchFromScan', () => {
  it('creates a batch with items for new books, duplicate groups, series, garbled', () => {
    const taskId = uuidv4();
    const scan: ScanResult = {
      new_books: [
        { file_path: '/a', title: '三体', file_format: 'txt', file_size: 100, fingerprint: 'f1', status: 'normal' },
      ],
      hard_duplicate_groups: [
        {
          canonical_file_path: '/x',
          members: [
            { file_path: '/x', fingerprint: 'same', decision_type: 'hard' },
            { file_path: '/y', fingerprint: 'same', decision_type: 'hard' },
          ],
        },
      ],
      ai_duplicate_groups: [],
      series_groups: [
        {
          series_name: '女生宿舍',
          author: 'X',
          members: [{ file_path: '/s1', sequence: 1 }, { file_path: '/s2', sequence: 2 }],
          source: 'regex',
        },
      ],
      garbled: [{ file_path: '/g', reason: 'random bytes' }],
      encoding_fixed: [{ file_path: '/e', from_encoding: 'gbk', to_encoding: 'utf-8' }],
    };

    const batch = buildBatchFromScan(taskId, scan, db);

    expect(batch.id).toBeTruthy();
    expect(batch.status).toBe('pending');

    const items = db.prepare('SELECT type, payload FROM scan_batch_items WHERE batch_id = ?').all(batch.id) as Array<{ type: string; payload: string }>;
    const typeCounts: Record<string, number> = {};
    for (const it of items) typeCounts[it.type] = (typeCounts[it.type] ?? 0) + 1;
    expect(typeCounts['new']).toBe(1);
    expect(typeCounts['duplicate_group']).toBe(1);
    expect(typeCounts['series']).toBe(1);
    expect(typeCounts['garbled']).toBe(1);
    expect(typeCounts['encoding_fixed']).toBe(1);

    const summary = JSON.parse(batch.summary_counts) as Record<string, number>;
    expect(summary.new).toBe(1);
    expect(summary.duplicate_groups).toBe(1);
  });
});
