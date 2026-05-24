import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import {
  ScanBatch,
  NewBookPayload,
  DuplicateGroupPayload,
  SeriesGroupPayload,
  GarbledPayload,
  EncodingFixedPayload,
} from '../types';

export interface ScanResult {
  new_books: NewBookPayload[];
  hard_duplicate_groups: DuplicateGroupPayload[];
  ai_duplicate_groups: DuplicateGroupPayload[];
  series_groups: SeriesGroupPayload[];
  garbled: GarbledPayload[];
  encoding_fixed: EncodingFixedPayload[];
}

/**
 * Persist a ScanResult as a scan_batch + items rows.
 * Caller may pass a custom DB (for tests); production should use getDb().
 */
export function buildBatchFromScan(
  taskId: string,
  scan: ScanResult,
  customDb?: Database.Database,
): ScanBatch {
  const database = customDb ?? getDb();
  const batchId = uuidv4();
  const summary = {
    new: scan.new_books.length,
    duplicate_groups: scan.hard_duplicate_groups.length + scan.ai_duplicate_groups.length,
    series: scan.series_groups.length,
    garbled: scan.garbled.length,
    encoding_fixed: scan.encoding_fixed.length,
  };
  database.prepare(
    `INSERT INTO scan_batches (id, task_id, status, summary_counts) VALUES (?, ?, 'pending', ?)`
  ).run(batchId, taskId, JSON.stringify(summary));

  const insert = database.prepare(
    `INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, ?, ?)`
  );

  const txn = database.transaction(() => {
    for (const nb of scan.new_books) {
      insert.run(uuidv4(), batchId, 'new', JSON.stringify(nb));
    }
    for (const dg of [...scan.hard_duplicate_groups, ...scan.ai_duplicate_groups]) {
      insert.run(uuidv4(), batchId, 'duplicate_group', JSON.stringify(dg));
    }
    for (const sg of scan.series_groups) {
      insert.run(uuidv4(), batchId, 'series', JSON.stringify(sg));
    }
    for (const g of scan.garbled) {
      insert.run(uuidv4(), batchId, 'garbled', JSON.stringify(g));
    }
    for (const e of scan.encoding_fixed) {
      insert.run(uuidv4(), batchId, 'encoding_fixed', JSON.stringify(e));
    }
  });
  txn();

  return database.prepare('SELECT * FROM scan_batches WHERE id = ?').get(batchId) as ScanBatch;
}
