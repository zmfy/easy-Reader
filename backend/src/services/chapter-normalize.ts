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
 * in book_chapter_overrides.
 *
 * AI results are collected first and written in one synchronous transaction at
 * the end, replacing only the index ranges whose batch succeeded: a failed (or
 * fully failed) run never wipes the user's existing overrides, and two
 * overlapping runs for the same book can't interleave their writes.
 */
export async function normalizeChaptersForBook(
  bookId: string,
  originalTitles: string[],
): Promise<NormalizeResult> {
  const db = getDb();
  const result: NormalizeResult = { total: originalTitles.length, normalized: 0, failed_batches: 0 };
  if (originalTitles.length === 0) return result;

  const succeeded: Array<{ start: number; end: number; titles: string[] }> = [];
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
    succeeded.push({ start, end: start + batch.length - 1, titles: normalizedBatch });
  }

  const clearRange = db.prepare(
    'DELETE FROM book_chapter_overrides WHERE book_id = ? AND chapter_index BETWEEN ? AND ?'
  );
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO book_chapter_overrides (book_id, chapter_index, normalized_title) VALUES (?, ?, ?)'
  );
  db.transaction(() => {
    for (const b of succeeded) {
      clearRange.run(bookId, b.start, b.end);
      b.titles.forEach((normalized, i) => {
        if (normalized && normalized !== originalTitles[b.start + i]) {
          upsert.run(bookId, b.start + i, normalized);
          result.normalized++;
        }
      });
    }
  })();

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
