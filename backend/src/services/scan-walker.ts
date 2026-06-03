import fs from 'fs';
import path from 'path';
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
import { buildCandidateGroups, ScannedBook } from './dedup-grouper';
import { buildBatchFromScan, ScanResult } from './batch-builder';

const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

export async function runScanTask(taskId: string, options: ScanOptions): Promise<void> {
  try {
    if (!fs.existsSync(BOOKS_DIR)) {
      finishScanTask(taskId, 'completed');
      return;
    }

    setScanProgress(taskId, { stage: 'walking' });
    const allFiles = collectFiles(BOOKS_DIR);
    setScanProgress(taskId, { total_files: allFiles.length, processed_files: 0 });

    // Cleanup orphans: delete DB rows whose file_path is no longer on disk.
    // Guard: skip when walk returned zero files (likely an empty BOOKS_DIR or a
    // broken bind-mount) — otherwise we'd wipe the whole library on every misconfig.
    if (allFiles.length > 0) {
      const db = getDb();
      const fileSet = new Set(allFiles);
      const rows = db.prepare('SELECT id, file_path FROM books').all() as {
        id: string;
        file_path: string;
      }[];
      const del = db.prepare('DELETE FROM books WHERE id = ?');
      let removed = 0;
      for (const row of rows) {
        if (!fileSet.has(row.file_path)) {
          del.run(row.id);
          removed++;
        }
      }
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
    const prefetched = new Map<string, { id: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null }>();
    if (!options.full_rescan) {
      const rows = getDb().prepare('SELECT id, file_path, fingerprint, file_size, file_mtime, fingerprint_version FROM books').all() as Array<{ id: string; file_path: string; fingerprint?: string; file_size?: number; file_mtime?: number | null; fingerprint_version?: number | null }>;
      for (const r of rows) prefetched.set(r.file_path, { id: r.id, fingerprint: r.fingerprint, file_size: r.file_size, file_mtime: r.file_mtime, fingerprint_version: r.fingerprint_version });
    }

    // Prepare once outside the loop — recompiling SQL on every migration-cohort
    // row would be wasteful for large libraries.
    const backfillMtimeStmt = getDb().prepare(
      'UPDATE books SET file_mtime = ? WHERE id = ?'
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
        processed++;
        if (processed % 50 === 0 || processed === allFiles.length) {
          setScanProgress(taskId, { processed_files: processed });
        }
        continue;
      }
      const result = await processFile(fullPath, options, st);
      if (result.scanned) scanned.push(result.scanned);
      if (result.garbled) garbled.push(result.garbled);
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
        series_groups: [],
        garbled,
        encoding_fixed: encodingFixed,
      };
      buildBatchFromScan(taskId, partial);
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

    const { hard_groups } = buildCandidateGroups(dedupInput);

    // AI dedup removed from scan (deterministic fingerprint dedup only).
    const aiDupGroups: DuplicateGroupPayload[] = [];

    // Hard groups always become duplicate_groups
    const hardDupPayloads: DuplicateGroupPayload[] = hard_groups.map(group => ({
      canonical_file_path: pickCanonical(group).file_path,
      members: group.map(b => ({
        file_path: b.file_path,
        fingerprint: b.fingerprint ?? '',
        decision_type: 'hard' as const,
      })),
    }));

    // Series grouping removed from scan (deferred to the future AI agent).
    const regexSeriesPayloads: SeriesGroupPayload[] = [];
    const aiSeriesPayloads: SeriesGroupPayload[] = [];

    // Phase 3: assemble result
    const result: ScanResult = {
      new_books: scanned.map(toNewPayload),
      hard_duplicate_groups: hardDupPayloads,
      ai_duplicate_groups: aiDupGroups,
      series_groups: [...regexSeriesPayloads, ...aiSeriesPayloads],
      garbled,
      encoding_fixed: encodingFixed,
    };

    // Phase 4: dispatch by mode
    const isEmpty = (r: ScanResult): boolean =>
      r.new_books.length === 0 &&
      r.hard_duplicate_groups.length === 0 &&
      r.ai_duplicate_groups.length === 0 &&
      r.series_groups.length === 0 &&
      r.garbled.length === 0 &&
      r.encoding_fixed.length === 0;

    setScanProgress(taskId, { stage: 'staging' });
    if (options.mode === 'auto') {
      if (!isEmpty(result)) {
        const batch = buildBatchFromScan(taskId, result);
        const { applyBatch } = await import('./batch-applier');
        applyBatch(batch.id, 'system-auto');
      } else {
        console.log(`[scan ${taskId}] empty result, no batch created`);
      }
    } else {
      // mode === 'review' — skip batch creation when result has nothing to review
      if (!isEmpty(result)) {
        buildBatchFromScan(taskId, result);
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
      setScanProgress(taskId, { stage: 'ai_fill' });
      const { batchFill } = await import('./ai-batch-fill');
      const toFill = db.prepare(`
        SELECT id, file_path, file_format FROM books
        WHERE status = 'normal' AND duplicate_of IS NULL
          AND (author IS NULL OR author = '')
          AND (summary IS NULL OR summary = '')
      `).all() as Array<{ id: string; file_path: string; file_format: string }>;
      console.log(`[scan ${taskId}] AI fill candidates: ${toFill.length}`);
      if (toFill.length > 0) {
        const result = await batchFill({ taskId, books: toFill });
        console.log(`[scan ${taskId}] AI fill done: ${result.succeeded.length} ok, ${result.failed.length} failed`);
      }
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

function collectFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
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
  return out;
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
  const result: ScannedBookEx = {
    file_path: fullPath,
    title,
    fingerprint: fp.fingerprint,
    first_chapter_hash: fp.first_chapter_hash,
    chapter_count: fp.chapter_count,
    first_chapter_preview: '',
    file_format: ext,
    file_size: st.size,
    file_mtime: st.mtimeMs,
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
