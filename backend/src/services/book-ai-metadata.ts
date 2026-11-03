import { getDb } from '../db';
import { BookAiMetadata } from '../types';

export interface SaveMetadataInput {
  book_id: string;
  recommended_tags?: string[];
  similar_works?: Array<{ title: string; author?: string; reason?: string }>;
  generated_by?: string;
}

/**
 * Upsert AI-generated metadata for a book. Empty arrays don't overwrite
 * existing non-empty values (so re-running AI fill doesn't wipe good data
 * if AI returns nothing this time).
 */
export function saveMetadata(input: SaveMetadataInput): void {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM book_ai_metadata WHERE book_id = ?').get(input.book_id) as
    | { recommended_tags?: string; similar_works?: string }
    | undefined;

  const newTags = input.recommended_tags && input.recommended_tags.length > 0
    ? JSON.stringify(input.recommended_tags)
    : existing?.recommended_tags ?? null;
  const newSimilar = input.similar_works && input.similar_works.length > 0
    ? JSON.stringify(input.similar_works)
    : existing?.similar_works ?? null;

  if (existing) {
    db.prepare(
      `UPDATE book_ai_metadata SET recommended_tags = ?, similar_works = ?,
       generated_by = ?, generated_at = CURRENT_TIMESTAMP WHERE book_id = ?`
    ).run(newTags, newSimilar, input.generated_by ?? null, input.book_id);
  } else {
    if (!newTags && !newSimilar) return;  // nothing to save
    db.prepare(
      `INSERT INTO book_ai_metadata (book_id, recommended_tags, similar_works, generated_by)
       VALUES (?, ?, ?, ?)`
    ).run(input.book_id, newTags, newSimilar, input.generated_by ?? null);
  }
}

export function getMetadata(bookId: string): BookAiMetadata | null {
  const row = getDb().prepare('SELECT * FROM book_ai_metadata WHERE book_id = ?').get(bookId) as
    | { book_id: string; recommended_tags?: string; similar_works?: string; generated_by?: string; generated_at: string }
    | undefined;
  if (!row) return null;
  let tags: string[] = [];
  let similar: BookAiMetadata['similar_works'] = [];
  try { if (row.recommended_tags) tags = JSON.parse(row.recommended_tags); } catch { /* ignore */ }
  try { if (row.similar_works) similar = JSON.parse(row.similar_works); } catch { /* ignore */ }
  return {
    book_id: row.book_id,
    recommended_tags: Array.isArray(tags) ? tags : [],
    similar_works: Array.isArray(similar) ? similar : [],
    generated_by: row.generated_by ?? null,
    generated_at: row.generated_at,
  };
}

/**
 * Extract metadata fields from a raw AI fillBookInfo response object.
 * AI may include recommended_tags / similar_works in its JSON; we strip them
 * here so the caller's Partial<Book> updater isn't confused by them.
 */
export function extractMetadataFromAiResponse(
  raw: Record<string, unknown>,
): { tags: string[]; similar: Array<{ title: string; author?: string; reason?: string }> } {
  let tags: string[] = [];
  let similar: Array<{ title: string; author?: string; reason?: string }> = [];

  const rawTags = raw.recommended_tags;
  if (Array.isArray(rawTags)) {
    tags = rawTags.filter(t => typeof t === 'string' && t.trim().length > 0).slice(0, 8);
  }

  const rawSimilar = raw.similar_works;
  if (Array.isArray(rawSimilar)) {
    similar = rawSimilar
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map(s => ({
        title: typeof s.title === 'string' ? s.title : '',
        author: typeof s.author === 'string' ? s.author : undefined,
        reason: typeof s.reason === 'string' ? s.reason : undefined,
      }))
      .filter(s => s.title.length > 0)
      .slice(0, 5);
  }

  return { tags, similar };
}
