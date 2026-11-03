import fs from 'fs';
import { getDb } from '../db';
import { assertPathInsideRoot } from '../utils/path-safe';
import { writeAudit } from './audit-log';

const DEFAULT_ROOT = process.env.BOOKS_DIR || '/app/books';

let rootOverride: string | null = null;
export function _setRootForTesting(root: string | null): void {
  rootOverride = root;
}
function root(): string {
  return rootOverride ?? DEFAULT_ROOT;
}

export interface DeleteRequest {
  file_path: string;
  book_id: string;
  cascade_duplicate_ids: string[];
  cascade_duplicate_paths: string[];
  user_id: string;
}

export interface DeleteResult {
  files_deleted: number;
  records_deleted: number;
  shelf_entries_affected: number;
  warnings: string[];
}

export interface DeleteOptions {
  dryRun?: boolean;
  skipDbOps?: boolean;
}

/**
 * Delete a book file + its DB record, optionally cascading to duplicate books.
 *
 * Safety:
 *  - All file paths must be inside the BOOKS_DIR root (path traversal prevention)
 *  - All operations are wrapped in a DB transaction; if any fails we throw and
 *    nothing commits (BUT note: files already removed from disk are not restored)
 */
export function deleteBookCascade(req: DeleteRequest, opts: DeleteOptions = {}): DeleteResult {
  assertPathInsideRoot(root(), req.file_path);
  for (const p of req.cascade_duplicate_paths) {
    assertPathInsideRoot(root(), p);
  }

  const result: DeleteResult = {
    files_deleted: 0,
    records_deleted: 0,
    shelf_entries_affected: 0,
    warnings: [],
  };

  if (opts.dryRun) return result;

  // Delete files first (irreversible)
  for (const fp of [req.file_path, ...req.cascade_duplicate_paths]) {
    try {
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        result.files_deleted++;
      } else {
        result.warnings.push('file not found');
      }
    } catch (err) {
      result.warnings.push(`failed to delete ${fp}: ${(err as Error).message}`);
    }
  }

  if (opts.skipDbOps) return result;

  const db = getDb();
  const tx = db.transaction(() => {
    const allBookIds = [req.book_id, ...req.cascade_duplicate_ids];
    const placeholders = allBookIds.map(() => '?').join(',');

    const affected = db.prepare(`SELECT COUNT(*) as cnt FROM shelf WHERE book_id IN (${placeholders})`).get(...allBookIds) as { cnt: number };
    result.shelf_entries_affected = affected.cnt;

    db.prepare(`DELETE FROM shelf WHERE book_id IN (${placeholders})`).run(...allBookIds);
    db.prepare(`DELETE FROM reading_progress WHERE book_id IN (${placeholders})`).run(...allBookIds);
    db.prepare(`DELETE FROM bookmarks WHERE book_id IN (${placeholders})`).run(...allBookIds);
    const r = db.prepare(`DELETE FROM books WHERE id IN (${placeholders})`).run(...allBookIds);
    result.records_deleted = r.changes;

    writeAudit({
      user_id: req.user_id,
      action: 'delete_book_file',
      resource_id: req.book_id,
      file_path: req.file_path,
      details: {
        cascade_ids: req.cascade_duplicate_ids,
        cascade_paths: req.cascade_duplicate_paths,
        files_deleted: result.files_deleted,
        records_deleted: result.records_deleted,
        shelf_entries_affected: result.shelf_entries_affected,
      },
    });
  });
  tx();

  return result;
}

/**
 * Count users affected if a book and its duplicates are deleted.
 */
export function countAffectedUsers(bookIds: string[]): number {
  if (bookIds.length === 0) return 0;
  const db = getDb();
  const placeholders = bookIds.map(() => '?').join(',');
  const row = db.prepare(
    `SELECT COUNT(DISTINCT user_id) as cnt FROM shelf WHERE book_id IN (${placeholders})`
  ).get(...bookIds) as { cnt: number };
  return row.cnt;
}

/**
 * Get duplicate book IDs and file_paths for a canonical book.
 */
export function getDuplicatesOf(bookId: string): Array<{ id: string; file_path: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, file_path FROM books WHERE duplicate_of = ?'
  ).all(bookId) as Array<{ id: string; file_path: string }>;
}
