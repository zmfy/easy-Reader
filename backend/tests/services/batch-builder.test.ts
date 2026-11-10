import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { randomUUID as uuidv4 } from 'crypto';
import { buildBatchFromScan, buildBatchesFromScan, ScanResult } from '../../src/services/batch-builder';

let db: Database.Database;
const TEST_DB = path.join(__dirname, '__test-batch-builder.db');

function setup(): void {
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  db = new Database(TEST_DB);
  db.exec(`
    CREATE TABLE scan_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', summary_counts TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, applied_at DATETIME, applied_by TEXT, part_index INTEGER, part_count INTEGER);
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
      soft_duplicate_groups: [],
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

  it('soft_duplicate_groups 作为 duplicate_group 入库且计入 summary', () => {
    const scan: ScanResult = {
      new_books: [], hard_duplicate_groups: [], ai_duplicate_groups: [],
      soft_duplicate_groups: [{
        canonical_file_path: '/a.txt',
        members: [
          { file_path: '/a.txt', fingerprint: 'fpA', decision_type: 'soft' as const },
          { file_path: '/b.txt', fingerprint: 'fpB', decision_type: 'soft' as const },
        ],
      }],
      series_groups: [], garbled: [], encoding_fixed: [],
    };
    const batch = buildBatchFromScan('task-soft', scan, db);
    const items = db.prepare("SELECT type FROM scan_batch_items WHERE batch_id = ?").all(batch.id) as Array<{ type: string }>;
    expect(items.filter(i => i.type === 'duplicate_group').length).toBe(1);
    expect(JSON.parse(batch.summary_counts).duplicate_groups).toBe(1);
  });
});


describe('buildBatchesFromScan 按书数拆批', () => {
  const nb = (p: string) => ({ file_path: p, title: p, file_format: 'txt', file_size: 1, fingerprint: 'f' + p, status: 'normal' as const });
  const empty = (): ScanResult => ({
    new_books: [], hard_duplicate_groups: [], ai_duplicate_groups: [], soft_duplicate_groups: [],
    series_groups: [], garbled: [], encoding_fixed: [],
  });
  const itemsOf = (batchId: string) =>
    (db.prepare('SELECT type, payload FROM scan_batch_items WHERE batch_id = ?').all(batchId) as Array<{ type: string; payload: string }>)
      .map(r => ({ type: r.type, payload: JSON.parse(r.payload) }));

  it('每批不超过上限，记录第几批 / 共几批', () => {
    const scan = empty();
    scan.new_books = Array.from({ length: 7 }, (_, i) => nb(`/b${i}`));
    const batches = buildBatchesFromScan('t', scan, db, 3);
    expect(batches.map(b => JSON.parse(b.summary_counts).new)).toEqual([3, 3, 1]);
    expect(batches.map(b => [b.part_index, b.part_count])).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('同一本书的新书、重复组、系列组、编码修复条目在同一批，不跨批', () => {
    const scan = empty();
    scan.new_books = ['/a', '/b', '/c', '/d', '/e'].map(nb);
    // /b 与 /d 是重复；/d 又与 /e 同属一个系列 → b、d、e 连成一块
    scan.hard_duplicate_groups = [{ canonical_file_path: '/b', members: [
      { file_path: '/b', fingerprint: 'x', decision_type: 'hard' }, { file_path: '/d', fingerprint: 'x', decision_type: 'hard' },
    ] }];
    scan.series_groups = [{ series_name: 'S', members: [{ file_path: '/d', sequence: 1 }, { file_path: '/e', sequence: 2 }], source: 'regex' }];
    scan.encoding_fixed = [{ file_path: '/e', from_encoding: 'gbk', to_encoding: 'utf-8' }];
    const batches = buildBatchesFromScan('t', scan, db, 3);
    const pathsPer = batches.map(b => itemsOf(b.id).flatMap(i =>
      i.type === 'new' || i.type === 'encoding_fixed' ? [i.payload.file_path]
        : i.type === 'series' ? i.payload.members.map((m: { file_path: string }) => m.file_path)
          : i.payload.members.map((m: { file_path: string }) => m.file_path)));
    const batchOf = (p: string) => pathsPer.findIndex(ps => ps.includes(p));
    expect(new Set([batchOf('/b'), batchOf('/d'), batchOf('/e')]).size).toBe(1);
    // 每个条目只出现在一批
    const all = batches.flatMap(b => itemsOf(b.id));
    expect(all).toHaveLength(5 + 1 + 1 + 1);
  });

  it('单块超过上限时独占一批', () => {
    const scan = empty();
    scan.new_books = ['/x', '/s1', '/s2', '/s3', '/s4'].map(nb);
    scan.series_groups = [{ series_name: 'S', members: ['/s1', '/s2', '/s3', '/s4'].map((p, i) => ({ file_path: p, sequence: i })), source: 'regex' }];
    const batches = buildBatchesFromScan('t', scan, db, 2);
    expect(batches.map(b => JSON.parse(b.summary_counts).new)).toEqual([1, 4]);
  });

  it('结果为空时仍建一个空批次（与原来一致）', () => {
    expect(buildBatchesFromScan('t', empty(), db, 3)).toHaveLength(1);
  });
});
