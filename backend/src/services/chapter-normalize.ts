import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';

const BATCH_SIZE = 40;

export interface NormalizeResult {
  total: number;
  normalized: number;
  failed_batches: number;
}

/**
 * Run AI normalization over a book's chapter list. Stores per-chapter overrides
 * in book_chapter_overrides. Replaces existing overrides (full re-run semantics).
 */
export async function normalizeChaptersForBook(
  bookId: string,
  originalTitles: string[],
): Promise<NormalizeResult> {
  const db = getDb();
  const result: NormalizeResult = { total: originalTitles.length, normalized: 0, failed_batches: 0 };
  if (originalTitles.length === 0) return result;

  // Clear existing overrides — we're doing a full re-run
  db.prepare('DELETE FROM book_chapter_overrides WHERE book_id = ?').run(bookId);

  const insert = db.prepare(
    'INSERT INTO book_chapter_overrides (book_id, chapter_index, normalized_title) VALUES (?, ?, ?)'
  );

  for (let start = 0; start < originalTitles.length; start += BATCH_SIZE) {
    const batch = originalTitles.slice(start, start + BATCH_SIZE);
    let normalizedBatch: string[];
    try {
      normalizedBatch = await aiManager.normalizeChapterTitles(batch, db);
    } catch {
      result.failed_batches++;
      continue;
    }
    if (normalizedBatch.length !== batch.length) {
      result.failed_batches++;
      continue;
    }
    const tx = db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        const original = batch[i];
        const normalized = normalizedBatch[i];
        if (normalized && normalized !== original) {
          insert.run(bookId, start + i, normalized);
          result.normalized++;
        }
      }
    });
    tx();
  }

  return result;
}

/**
 * Return a map of chapter_index → normalized_title for the book. Used by the
 * reader route to merge into plugin.getChapters() output.
 */
export function getOverridesMap(bookId: string): Map<number, string> {
  const rows = getDb().prepare(
    'SELECT chapter_index, normalized_title FROM book_chapter_overrides WHERE book_id = ?'
  ).all(bookId) as Array<{ chapter_index: number; normalized_title: string }>;
  const map = new Map<number, string>();
  for (const r of rows) map.set(r.chapter_index, r.normalized_title);
  return map;
}

export function clearOverrides(bookId: string): number {
  const r = getDb().prepare('DELETE FROM book_chapter_overrides WHERE book_id = ?').run(bookId);
  return r.changes;
}

export function getOverrideCount(bookId: string): number {
  const row = getDb().prepare(
    'SELECT COUNT(*) as c FROM book_chapter_overrides WHERE book_id = ?'
  ).get(bookId) as { c: number };
  return row.c;
}
