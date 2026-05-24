import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db';
import { detectAndFixEncoding } from '../utils/encoding';
import { computeFingerprint } from '../utils/fingerprint';
import {
  setScanProgress,
  finishScanTask,
  isCancelled,
} from './scan-task';
import { ScanOptions } from '../types';

const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

/**
 * Run the scan in the background. Should be invoked via setImmediate from the route.
 * Caller has already created a 'running' scan_task; we update its progress and finish it.
 */
export async function runScanTask(taskId: string, options: ScanOptions): Promise<void> {
  try {
    if (!fs.existsSync(BOOKS_DIR)) {
      finishScanTask(taskId, 'completed');
      return;
    }

    // Phase 1: walk to count files
    setScanProgress(taskId, { stage: 'walking' });
    const allFiles: string[] = collectFiles(BOOKS_DIR);
    setScanProgress(taskId, { total_files: allFiles.length, processed_files: 0 });

    // Phase 2: per-file processing
    setScanProgress(taskId, { stage: 'fingerprinting' });
    let processed = 0;
    for (const fullPath of allFiles) {
      if (isCancelled(taskId)) {
        // honor cancellation; finishScanTask was already called by cancelScanTask
        return;
      }
      await processOneFile(fullPath, options);
      processed++;
      // Update progress every 5 files to reduce DB writes
      if (processed % 5 === 0 || processed === allFiles.length) {
        setScanProgress(taskId, { processed_files: processed });
      }
    }

    setScanProgress(taskId, { stage: 'staging', processed_files: allFiles.length });
    finishScanTask(taskId, 'completed');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishScanTask(taskId, 'failed', msg);
    console.error('Scan task failed:', err);
  }
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

async function processOneFile(fullPath: string, options: ScanOptions): Promise<void> {
  const db = getDb();
  const ext = path.extname(fullPath).slice(1).toLowerCase();
  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(fullPath) as
    | { id: string; fingerprint?: string; status?: string }
    | undefined;

  // Skip if already present AND has fingerprint AND not full_rescan
  if (existing && existing.fingerprint && !options.full_rescan) return;

  // Encoding (only for txt; epub/pdf assumed binary)
  let status: 'normal' | 'encoding_fixed' | 'garbled' = 'normal';
  let encoding = 'utf-8';
  if (ext === 'txt') {
    try {
      const enc = await detectAndFixEncoding(fullPath);
      status = enc.status;
      encoding = enc.encoding;
    } catch (err) {
      // If encoding check fails, mark garbled
      status = 'garbled';
      encoding = 'unknown';
    }
  }

  // Fingerprint
  let fp: Awaited<ReturnType<typeof computeFingerprint>> | null = null;
  if (status !== 'garbled') {
    try {
      fp = await computeFingerprint(fullPath, ext);
    } catch {
      status = 'garbled';
    }
  }

  const stat = fs.statSync(fullPath);
  const title = path.basename(fullPath, path.extname(fullPath));

  if (existing) {
    // Update existing row with new fingerprint / encoding / status
    db.prepare(
      `UPDATE books SET
         status = ?,
         encoding_detected = ?,
         fingerprint = ?,
         first_chapter_hash = ?,
         chapter_count = ?,
         file_size = ?
       WHERE id = ?`
    ).run(
      status,
      encoding,
      fp?.fingerprint ?? null,
      fp?.first_chapter_hash ?? null,
      fp?.chapter_count ?? null,
      stat.size,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO books (
         id, title, file_path, file_format, file_size,
         status, encoding_detected, fingerprint, first_chapter_hash, chapter_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uuidv4(),
      title,
      fullPath,
      ext,
      stat.size,
      status,
      encoding,
      fp?.fingerprint ?? null,
      fp?.first_chapter_hash ?? null,
      fp?.chapter_count ?? null,
    );
  }
}
