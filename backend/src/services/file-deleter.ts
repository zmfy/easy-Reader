import fs from 'fs';
import { getDb } from '../db';
import { assertPathInsideRoot } from '../utils/path-safe';
import { removeCoverFiles } from '../utils/cover';
import { writeAudit } from './audit-log';
import { deleteBookRelations } from './relation-cleanup';
import { organizedDir } from './txt-organize/writer';

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
  /** 其中的整理版（organized_from 不为空）：文件在整理版目录而不在书库内 */
  organized_ids?: string[];
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
  /** Only remove DB records; leave files on disk untouched (they may be re-imported by the next scan). */
  keepFiles?: boolean;
}

/**
 * Delete a book file + its DB record, optionally cascading to duplicate books.
 *
 * Safety:
 *  - All file paths must be inside the BOOKS_DIR root (path traversal prevention);
 *    整理版（organized_ids）的文件改为必须在整理版目录内，删记录时一并删掉它的封面副本
 *  - All operations are wrapped in a DB transaction; if any fails we throw and
 *    nothing commits (BUT note: files already removed from disk are not restored)
 */
export function deleteBookCascade(req: DeleteRequest, opts: DeleteOptions = {}): DeleteResult {
  // Path checks guard file deletion; a record-only delete never touches the disk
  const organized = new Set(req.organized_ids ?? []);
  const rootOf = (id: string) => (organized.has(id) ? organizedDir() : root());
  if (!opts.keepFiles) {
    assertPathInsideRoot(rootOf(req.book_id), req.file_path);
    req.cascade_duplicate_paths.forEach((p, i) => {
      assertPathInsideRoot(rootOf(req.cascade_duplicate_ids[i]), p);
    });
  }

  const result: DeleteResult = {
    files_deleted: 0,
    records_deleted: 0,
    shelf_entries_affected: 0,
    warnings: [],
  };

  if (opts.dryRun) return result;

  // Delete files first (irreversible)
  for (const fp of opts.keepFiles ? [] : [req.file_path, ...req.cascade_duplicate_paths]) {
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

    deleteBookRelations(db, allBookIds);
    const r = db.prepare(`DELETE FROM books WHERE id IN (${placeholders})`).run(...allBookIds);
    result.records_deleted = r.changes;

    writeAudit({
      user_id: req.user_id,
      action: opts.keepFiles ? 'delete_book_record' : 'delete_book_file',
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

  // 整理版的封面是整理时复制出来的副本，记录删了就没用了
  for (const id of organized) {
    try {
      removeCoverFiles(id);
    } catch (err) {
      result.warnings.push(`failed to remove covers of ${id}: ${(err as Error).message}`);
    }
  }

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
export function getDuplicatesOf(bookId: string): Array<{ id: string; file_path: string; organized_from: string | null }> {
  const db = getDb();
  return db.prepare(
    'SELECT id, file_path, organized_from FROM books WHERE duplicate_of = ?'
  ).all(bookId) as Array<{ id: string; file_path: string; organized_from: string | null }>;
}
