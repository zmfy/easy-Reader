import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { detectAndFixEncoding } from '../utils/encoding';
import { computeFingerprint } from '../utils/fingerprint';
import {
  setScanProgress,
  finishScanTask,
  isCancelled,
} from './scan-task';
import { FINGERPRINT_VERSION, shouldReuseFingerprint } from './scan-versions';
import {
  ScanOptions,
  NewBookPayload,
  EncodingFixedPayload,
  GarbledPayload,
  DuplicateGroupPayload,
  SeriesGroupPayload,
} from '../types';
import { buildCandidateGroups, applyNotDuplicateOverrides, mergeDuplicateGroups, ScannedBook } from './dedup-grouper';
import { listOverrides } from './manual-override';
import { buildBatchesFromScan, ScanResult } from './batch-builder';
import { notifyScanReview } from './notices';
import { extractAuthorFromName } from '../utils/title-normalizer';
import { deleteBookRelations } from './relation-cleanup';

const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub', 'umd'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

export async function runScanTask(taskId: string, options: ScanOptions): Promise<void> {
  try {
    if (!fs.existsSync(BOOKS_DIR)) {
      finishScanTask(taskId, 'completed');
      return;
    }

    setScanProgress(taskId, { stage: 'walking' });
    const walk = collectFiles(BOOKS_DIR);
    const allFiles = walk.files;
    if (walk.unreadableDirs.length > 0) {
      console.warn(`[scan ${taskId}] ${walk.unreadableDirs.length} 个目录读取失败，其中的书本次不做清理:`, walk.unreadableDirs);
    }
    setScanProgress(taskId, { total_files: allFiles.length, processed_files: 0 });

    // Cleanup orphans: delete DB rows whose file_path is no longer on disk.
    // Guard: skip when walk returned zero files (likely an empty BOOKS_DIR or a
    // broken bind-mount) — otherwise we'd wipe the whole library on every misconfig.
    if (allFiles.length > 0) {
      const db = getDb();
      const rows = db.prepare('SELECT id, file_path FROM books').all() as {
        id: string;
        file_path: string;
      }[];
      const orphanIds = findOrphanBookIds(rows, walk);
      removeOrphanBooks(db, orphanIds);
      const removed = orphanIds.length;
      if (removed > 0) console.log(`[scan ${taskId}] cleaned ${removed} orphan record(s)`);
    }

    // Phase 1: per-file processing (encoding + fingerprint)
    setScanProgress(taskId, { stage: 'fingerprinting' });
    const scanned: ScannedBookEx[] = [];
    const garbled: GarbledPayload[] = [];
    const encodingFixed: EncodingFixedPayload[] = [];
    let processed = 0;

    // Performance: prefetch all existing books in ONE query so the per-file
    // skip check is an in-memory lookup rather than N individual SQL hits.
    // For 8000+ books this turns 8000 prepare/get round-trips into 1.
    const prefetched = new Map<string, { id: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null; status?: string | null }>();
    if (!options.full_rescan) {
      const rows = getDb().prepare('SELECT id, file_path, fingerprint, file_size, file_mtime, fingerprint_version, status FROM books').all() as Array<{ id: string; file_path: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null; status?: string | null }>;
      for (const r of rows) prefetched.set(r.file_path, { id: r.id, fingerprint: r.fingerprint, file_size: r.file_size, file_mtime: r.file_mtime, fingerprint_version: r.fingerprint_version, status: r.status });
    }

    // 已标记为乱码的文件（全量重扫时 prefetched 为空，因此单独查询）
    const knownGarbledPaths = new Set(
      (getDb().prepare("SELECT file_path FROM books WHERE status = 'garbled'").all() as Array<{ file_path: string }>)
        .map(r => r.file_path),
    );

    // Prepare once outside the loop — recompiling SQL on every migration-cohort
    // row would be wasteful for large libraries.
    const backfillMtimeStmt = getDb().prepare(
      'UPDATE books SET file_mtime = ? WHERE id = ?'
    );
    const backfillAuthorStmt = getDb().prepare(
      "UPDATE books SET author = ? WHERE id = ? AND (author IS NULL OR author = '')"
    );

    for (const fullPath of allFiles) {
      if (isCancelled(taskId)) return;
      let st: fs.Stats;
      try { st = fs.statSync(fullPath); } catch { processed++; continue; }
      const pre = prefetched.get(fullPath);
      if (shouldReuseFingerprint({ existing: pre, statSize: st.size, statMtime: st.mtimeMs, fingerprintVersion: FINGERPRINT_VERSION, fullRescan: options.full_rescan })) {
        // Backfill a migration-leftover NULL mtime without re-reading the file.
        // fingerprint_version is NOT written here: shouldReuseFingerprint only
        // returns true when fingerprint_version === FINGERPRINT_VERSION already,
        // so that column is already correct.
        if (pre && pre.file_mtime == null) {
          backfillMtimeStmt.run(st.mtimeMs, pre.id);
        }
        // Backfill author for books imported before author-extraction was added.
        // The WHERE guard ensures an existing non-empty author is never overwritten.
        if (pre) {
          const a = extractAuthorFromName(path.basename(fullPath));
          if (a) backfillAuthorStmt.run(a, pre.id);
        }
        processed++;
        if (processed % 50 === 0 || processed === allFiles.length) {
          setScanProgress(taskId, { processed_files: processed });
        }
        continue;
      }
      const result = await processFile(fullPath, options, st);
      if (result.scanned) scanned.push(result.scanned);
      // 已标记为乱码的书仍会重新检测（检测改进后可被「救回」为新书），但仍是乱码时
      // 不再重复生成审核项，否则审核模式每次扫描都会产生待审核批次
      if (result.garbled && !knownGarbledPaths.has(fullPath)) garbled.push(result.garbled);
      if (result.encoding_fixed) encodingFixed.push(result.encoding_fixed);
      processed++;
      if (processed % 5 === 0 || processed === allFiles.length) {
        setScanProgress(taskId, { processed_files: processed });
      }
    }

    if (isCancelled(taskId)) {
      // Still try to stage partial results if we have any
      const partial: ScanResult = {
        new_books: scanned.map(toNewPayload),
        hard_duplicate_groups: [],
        ai_duplicate_groups: [],
        soft_duplicate_groups: [],
        series_groups: [],
        garbled,
        encoding_fixed: encodingFixed,
      };
      buildBatchesFromScan(taskId, partial);
      notifyScanReview();
      return;
    }

    // Phase 2: build candidate set for dedup + series.
    // IMPORTANT: incremental scans skip files that already have a fingerprint,
    // so `scanned` may be nearly empty even when the user wants to re-classify
    // existing books. Pull books already in DB into the candidate set so series
    // / dedup detection works without requiring full_rescan.
    setScanProgress(taskId, { stage: 'dedup' });
    const db = getDb();
    const scannedPaths = new Set(scanned.map(b => b.file_path));

    // Pull untagged normal books (not duplicates, not already in a series)
    const existing = db.prepare(`
      SELECT file_path, title, author, fingerprint, first_chapter_hash, chapter_count
      FROM books
      WHERE status = 'normal'
        AND (duplicate_of IS NULL OR duplicate_of = '')
        AND (series_id IS NULL OR series_id = '')
    `).all() as Array<{ file_path: string; title: string; author?: string; fingerprint?: string; first_chapter_hash?: string; chapter_count?: number }>;

    const dedupInput: ScannedBook[] = [
      ...scanned,
      ...existing
        .filter(b => !scannedPaths.has(b.file_path) && b.fingerprint)
        .map(b => ({
          file_path: b.file_path,
          title: b.title,
          author: b.author,
          fingerprint: b.fingerprint,
          first_chapter_hash: b.first_chapter_hash,
          chapter_count: b.chapter_count,
          first_chapter_preview: '',
        })),
    ];

    const candidateGroups = buildCandidateGroups(dedupInput);

    // 过滤管理员已判定「不是重复」的成员（manual_overrides），否则被拒绝的组每次扫描都会重现
    const idByPath = new Map(
      (db.prepare('SELECT id, file_path FROM books').all() as Array<{ id: string; file_path: string }>)
        .map(r => [r.file_path, r.id] as [string, string]),
    );
    const notDuplicatePairs = new Set(
      listOverrides('not_duplicate').flatMap(o =>
        o.book_id_a && o.book_id_b ? [`${o.book_id_a}|${o.book_id_b}`, `${o.book_id_b}|${o.book_id_a}`] : [],
      ),
    );
    const hard_groups = applyNotDuplicateOverrides(candidateGroups.hard_groups, idByPath, notDuplicatePairs);
    const title_author_groups = applyNotDuplicateOverrides(candidateGroups.title_author_groups, idByPath, notDuplicatePairs);

    // AI dedup removed from scan (deterministic fingerprint dedup only).
    const aiDupGroups: DuplicateGroupPayload[] = [];

    // 硬重复组与书名软重复组有交集时合成一组（一本书只能出现在一个重复组里）
    const hardDupPayloads: DuplicateGroupPayload[] = [];
    const softDupPayloads: DuplicateGroupPayload[] = [];
    for (const { books: group, hardPaths } of mergeDuplicateGroups(hard_groups, title_author_groups)) {
      const payload: DuplicateGroupPayload = {
        canonical_file_path: pickCanonical(group).file_path,
        members: group.map(b => ({
          file_path: b.file_path,
          fingerprint: b.fingerprint ?? '',
          decision_type: hardPaths.has(b.file_path) ? 'hard' as const : 'soft' as const,
        })),
      };
      (hardPaths.size > 0 ? hardDupPayloads : softDupPayloads).push(payload);
    }

    // Series grouping removed from scan (deferred to the future AI agent).
    const regexSeriesPayloads: SeriesGroupPayload[] = [];
    const aiSeriesPayloads: SeriesGroupPayload[] = [];

    // Phase 3: assemble result
    const result: ScanResult = {
      new_books: scanned.map(toNewPayload),
      hard_duplicate_groups: hardDupPayloads,
      ai_duplicate_groups: aiDupGroups,
      series_groups: [...regexSeriesPayloads, ...aiSeriesPayloads],
      soft_duplicate_groups: softDupPayloads,
      garbled,
      encoding_fixed: encodingFixed,
    };

    // Phase 4: dispatch by mode
    const isEmpty = (r: ScanResult): boolean =>
      r.new_books.length === 0 &&
      r.hard_duplicate_groups.length === 0 &&
      r.ai_duplicate_groups.length === 0 &&
      r.series_groups.length === 0 &&
      r.soft_duplicate_groups.length === 0 &&
      r.garbled.length === 0 &&
      r.encoding_fixed.length === 0;

    setScanProgress(taskId, { stage: 'staging' });
    if (options.mode === 'auto') {
      if (!isEmpty(result)) {
        const { applyBatch } = await import('./batch-applier');
        for (const batch of buildBatchesFromScan(taskId, result)) applyBatch(batch.id, 'system-auto');
      } else {
        console.log(`[scan ${taskId}] empty result, no batch created`);
      }
    } else {
      // mode === 'review' — skip batch creation when result has nothing to review
      if (!isEmpty(result)) {
        buildBatchesFromScan(taskId, result);
        notifyScanReview();   // 与之前未审核的合并成一条提醒
      } else {
        console.log(`[scan ${taskId}] empty result, no batch created`);
      }
    }

    // Phase 5: AI batch fill (if enabled).
    // Decoupled from mode — ai_fill operates on books ALREADY in the books table
    // that are missing author or summary, regardless of whether this scan ran
    // in review or auto mode. (For review mode, books staged in this scan are in
    // scan_batch_items, not books table — they'll be eligible for AI fill only
    // after the admin applies the batch and runs another scan with ai_fill on.)
    if (options.ai_fill) {
      const { runAiFill } = await import('./ai-fill-task');
      const r = await runAiFill(taskId, 'system-scan');
      if (r) console.log(`[scan ${taskId}] AI fill done: ${r.succeeded.length} ok, ${r.failed.length} failed${r.paused ? `, paused: ${r.paused.message}` : ''}`);
    }

    finishScanTask(taskId, 'completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishScanTask(taskId, 'failed', msg);
    console.error('Scan task failed:', err);
  }
}

interface ScannedBookEx extends ScannedBook {
  file_format: string;
  file_size: number;
  file_mtime: number;
  encoding_detected: string;
  status: 'normal' | 'encoding_fixed';
}

function toNewPayload(b: ScannedBookEx): NewBookPayload {
  return {
    file_path: b.file_path,
    title: b.title,
    author: b.author,
    file_format: b.file_format,
    file_size: b.file_size,
    file_mtime: b.file_mtime,
    fingerprint_version: FINGERPRINT_VERSION,
    chapter_count: b.chapter_count,
    fingerprint: b.fingerprint,
    encoding_detected: b.encoding_detected,
    status: b.status,
  };
}

function pickCanonical(group: ScannedBook[]): ScannedBook {
  return [...group].sort((a, b) => {
    const cca = a.chapter_count ?? 0;
    const ccb = b.chapter_count ?? 0;
    if (ccb !== cca) return ccb - cca;
    return a.file_path.length - b.file_path.length;
  })[0];
}

export interface WalkResult {
  files: string[];
  /** Directories that could not be read (EIO / EACCES / flaky mount) */
  unreadableDirs: string[];
}

export function collectFiles(root: string): WalkResult {
  const out: string[] = [];
  const unreadableDirs: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      unreadableDirs.push(dir);
      continue;
    }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(fp);
      else if (e.isFile()) {
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (SUPPORTED_FORMATS.includes(ext)) out.push(fp);
      }
    }
  }
  return { files: out, unreadableDirs };
}

/**
 * Delete books whose files are gone, together with their per-book data.
 * Duplicates that pointed at a removed book are promoted back to normal books;
 * otherwise they'd stay hidden forever (lists hide duplicates and the dedup
 * candidate query skips rows with duplicate_of). The next scan regroups them.
 */
export function removeOrphanBooks(db: Database.Database, orphanIds: string[]): void {
  if (orphanIds.length === 0) return;
  const orphanSet = new Set(orphanIds);
  // 分批执行：整库路径变化（如更换挂载目录）时 orphan 可能上万，避免超出 SQLite 参数上限
  const CHUNK = 500;
  db.transaction(() => {
    for (let i = 0; i < orphanIds.length; i += CHUNK) {
      const chunk = orphanIds.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      deleteBookRelations(db, chunk);
      const dependants = db.prepare(`SELECT id FROM books WHERE duplicate_of IN (${placeholders})`).all(...chunk) as { id: string }[];
      const promote = db.prepare("UPDATE books SET status = 'normal', duplicate_of = NULL WHERE id = ?");
      for (const d of dependants) if (!orphanSet.has(d.id)) promote.run(d.id);
      db.prepare(`DELETE FROM books WHERE id IN (${placeholders})`).run(...chunk);
    }
  })();
}

/**
 * Books whose file was not found by the walk. Books inside a directory that
 * could not be read are NOT orphans — they are merely invisible this time, and
 * deleting them would also wipe users' shelf / progress / bookmarks.
 */
export function findOrphanBookIds(rows: Array<{ id: string; file_path: string }>, walk: WalkResult): string[] {
  const fileSet = new Set(walk.files);
  const unreadablePrefixes = walk.unreadableDirs.map(d => d.endsWith(path.sep) ? d : d + path.sep);
  return rows
    .filter(row => !fileSet.has(row.file_path))
    .filter(row => !unreadablePrefixes.some(prefix => row.file_path.startsWith(prefix)))
    .map(row => row.id);
}

async function processFile(
  fullPath: string,
  options: ScanOptions,
  st: fs.Stats,
): Promise<{
  scanned?: ScannedBookEx;
  garbled?: GarbledPayload;
  encoding_fixed?: EncodingFixedPayload;
}> {
  const db = getDb();
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  // NOTE: the main loop owns skip decisions via shouldReuseFingerprint;
  // processFile only runs for files that need re-reading/re-hashing.

  let status: 'normal' | 'encoding_fixed' | 'garbled' = 'normal';
  let encoding = 'utf-8';
  if (ext === 'txt') {
    try {
      const enc = await detectAndFixEncoding(fullPath);
      if (enc.status === 'uncertain') {
        return { garbled: { file_path: fullPath, reason: `low ratio ${(enc.best_ratio ?? 0).toFixed(2)}` } };
      }
      status = enc.status;
      encoding = enc.encoding;
    } catch {
      status = 'garbled';
      encoding = 'unknown';
    }
  }

  if (status === 'garbled') {
    return { garbled: { file_path: fullPath, reason: 'failed encoding detection' } };
  }

  let fp: Awaited<ReturnType<typeof computeFingerprint>> | null = null;
  try {
    fp = await computeFingerprint(fullPath, ext);
  } catch {
    return { garbled: { file_path: fullPath, reason: 'failed fingerprint' } };
  }

  const title = path.basename(fullPath, path.extname(fullPath));

  const wasEncodingFixed = status === 'encoding_fixed';
  // 编码修复会改写文件：必须用改写后的 size/mtime 入库，否则下次扫描会判定文件已变化而重复处理
  const finalStat = wasEncodingFixed ? fs.statSync(fullPath) : st;
  const result: ScannedBookEx = {
    file_path: fullPath,
    title,
    author: extractAuthorFromName(path.basename(fullPath)) ?? undefined,
    fingerprint: fp.fingerprint,
    first_chapter_hash: fp.first_chapter_hash,
    chapter_count: fp.chapter_count,
    first_chapter_preview: '',
    file_format: ext,
    file_size: finalStat.size,
    file_mtime: finalStat.mtimeMs,
    encoding_detected: encoding,
    status: wasEncodingFixed ? 'encoding_fixed' : 'normal',
  };

  if (wasEncodingFixed) {
    return {
      scanned: result,
      encoding_fixed: { file_path: fullPath, from_encoding: encoding, to_encoding: 'utf-8' },
    };
  }
  return { scanned: result };
}
