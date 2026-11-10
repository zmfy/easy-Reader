import Database from 'better-sqlite3';
import { randomUUID as uuidv4 } from 'crypto';
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
  soft_duplicate_groups: DuplicateGroupPayload[];
  series_groups: SeriesGroupPayload[];
  garbled: GarbledPayload[];
  encoding_fixed: EncodingFixedPayload[];
}

/** 扫描审核每批最多这么多本书（同一本书的新书 / 重复组 / 系列组条目总在同一批） */
export const SCAN_BATCH_SIZE = 500;

type BatchEntry = { type: string; payload: unknown; paths: string[] };

function entriesOf(scan: ScanResult): BatchEntry[] {
  return [
    ...scan.new_books.map(nb => ({ type: 'new', payload: nb, paths: [nb.file_path] })),
    ...[...scan.hard_duplicate_groups, ...scan.ai_duplicate_groups, ...scan.soft_duplicate_groups].map(dg => ({
      type: 'duplicate_group', payload: dg, paths: [dg.canonical_file_path, ...dg.members.map(m => m.file_path)],
    })),
    ...scan.series_groups.map(sg => ({ type: 'series', payload: sg, paths: sg.members.map(m => m.file_path) })),
    ...scan.garbled.map(g => ({ type: 'garbled', payload: g, paths: [g.file_path] })),
    ...scan.encoding_fixed.map(e => ({ type: 'encoding_fixed', payload: e, paths: [e.file_path] })),
  ];
}

/**
 * 把条目按涉及的文件连成块（并查集：同一文件的新书、重复组、系列组、乱码 / 编码修复条目必在同一块），
 * 再按书数装箱，每批不超过 size 本；单块超过 size 时独占一批。各批互不依赖，可分别审核、应用。
 */
export function partitionScanEntries(entries: BatchEntry[], size: number): BatchEntry[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const e of entries) {
    for (const p of e.paths) if (!parent.has(p)) parent.set(p, p);
    for (let i = 1; i < e.paths.length; i++) {
      const a = find(e.paths[0]);
      const b = find(e.paths[i]);
      if (a !== b) parent.set(b, a);
    }
  }
  // 块按首次出现的顺序排列
  const blocks = new Map<string, { entries: BatchEntry[]; paths: Set<string> }>();
  for (const e of entries) {
    const root = e.paths.length > 0 ? find(e.paths[0]) : `\u0000${blocks.size}`;
    let blk = blocks.get(root);
    if (!blk) { blk = { entries: [], paths: new Set() }; blocks.set(root, blk); }
    blk.entries.push(e);
    for (const p of e.paths) blk.paths.add(p);
  }
  const chunks: BatchEntry[][] = [];
  let cur: BatchEntry[] = [];
  let curSize = 0;
  for (const blk of blocks.values()) {
    const n = Math.max(1, blk.paths.size);
    if (curSize > 0 && curSize + n > size) {
      chunks.push(cur);
      cur = [];
      curSize = 0;
    }
    cur.push(...blk.entries);
    curSize += n;
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks;
}

/**
 * Persist a ScanResult as one or more scan_batches（每批最多 size 本书）+ items rows.
 * Caller may pass a custom DB (for tests); production should use getDb().
 */
export function buildBatchesFromScan(
  taskId: string,
  scan: ScanResult,
  customDb?: Database.Database,
  size: number = SCAN_BATCH_SIZE,
): ScanBatch[] {
  const database = customDb ?? getDb();
  const chunks = partitionScanEntries(entriesOf(scan), size);
  if (chunks.length === 0) chunks.push([]);
  const insertBatch = database.prepare(
    `INSERT INTO scan_batches (id, task_id, status, summary_counts, part_index, part_count) VALUES (?, ?, 'pending', ?, ?, ?)`
  );
  const insertItem = database.prepare(
    `INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES (?, ?, ?, ?)`
  );
  const ids: string[] = [];
  database.transaction(() => {
    chunks.forEach((chunk, i) => {
      const batchId = uuidv4();
      ids.push(batchId);
      const count = (t: string) => chunk.filter(e => e.type === t).length;
      const summary = {
        new: count('new'),
        duplicate_groups: count('duplicate_group'),
        series: count('series'),
        garbled: count('garbled'),
        encoding_fixed: count('encoding_fixed'),
      };
      insertBatch.run(batchId, taskId, JSON.stringify(summary), i + 1, chunks.length);
      for (const e of chunk) insertItem.run(uuidv4(), batchId, e.type, JSON.stringify(e.payload));
    });
  })();
  const get = database.prepare('SELECT * FROM scan_batches WHERE id = ?');
  return ids.map(id => get.get(id) as ScanBatch);
}

/** 不拆分，整个扫描结果存成一批 */
export function buildBatchFromScan(
  taskId: string,
  scan: ScanResult,
  customDb?: Database.Database,
): ScanBatch {
  return buildBatchesFromScan(taskId, scan, customDb, Infinity)[0];
}
