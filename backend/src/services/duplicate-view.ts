import type Database from 'better-sqlite3';

const GROUP_WHERE = `WHERE (status = 'duplicate'
  OR id IN (SELECT DISTINCT duplicate_of FROM books
            WHERE duplicate_of IS NOT NULL AND duplicate_of != ''))`;

/** Books that belong to any duplicate group: the canonical kept book + its hidden duplicates. */
export function selectDuplicateGroupBooks(
  db: Database.Database,
  limit: number,
  offset: number,
): { rows: Record<string, unknown>[]; total: number } {
  const total = (db.prepare(`SELECT COUNT(*) c FROM books ${GROUP_WHERE}`).get() as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM books ${GROUP_WHERE}
     ORDER BY COALESCE(NULLIF(duplicate_of, ''), id), id
     LIMIT ? OFFSET ?`
  ).all(limit, offset) as Record<string, unknown>[];
  return { rows, total };
}
