import { randomUUID as uuidv4 } from 'crypto';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { ManualOverride, ManualOverrideType, ManualOverrideWithNames } from '../types';

let dbOverride: Database.Database | null = null;
export function _setDbForTesting(database: Database.Database | null): void {
  dbOverride = database;
}
function db(): Database.Database {
  return dbOverride ?? getDb();
}

export interface CreateOverrideInput {
  type: ManualOverrideType;
  book_id_a: string | null;
  book_id_b?: string | null;
  series_id?: string | null;
  created_by: string;
}

export function createOverride(input: CreateOverrideInput): ManualOverride {
  const id = uuidv4();
  db().prepare(
    `INSERT INTO manual_overrides (id, type, book_id_a, book_id_b, series_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, input.type, input.book_id_a, input.book_id_b ?? null, input.series_id ?? null, input.created_by);
  return db().prepare('SELECT * FROM manual_overrides WHERE id = ?').get(id) as ManualOverride;
}

export function listOverrides(type?: ManualOverrideType): ManualOverride[] {
  if (type) {
    return db().prepare('SELECT * FROM manual_overrides WHERE type = ? ORDER BY created_at DESC').all(type) as ManualOverride[];
  }
  return db().prepare('SELECT * FROM manual_overrides ORDER BY created_at DESC').all() as ManualOverride[];
}

/** 人工修正记录页用：带上两本书的书名、系列名（书或系列已删除时为 null） */
export function listOverridesWithNames(type?: ManualOverrideType): ManualOverrideWithNames[] {
  return db().prepare(
    `SELECT o.*, a.title AS title_a, b.title AS title_b, s.name AS series_name
     FROM manual_overrides o
     LEFT JOIN books a ON a.id = o.book_id_a
     LEFT JOIN books b ON b.id = o.book_id_b
     LEFT JOIN series s ON s.id = o.series_id
     ${type ? 'WHERE o.type = ?' : ''}
     ORDER BY o.created_at DESC`
  ).all(...(type ? [type] : [])) as ManualOverrideWithNames[];
}

export function deleteOverride(id: string): boolean {
  const r = db().prepare('DELETE FROM manual_overrides WHERE id = ?').run(id);
  return r.changes > 0;
}

export function deleteAllOverrides(): number {
  const r = db().prepare('DELETE FROM manual_overrides').run();
  return r.changes;
}

/**
 * Returns true if A and B are declared "not duplicate" by an admin override.
 */
export function isNotDuplicate(bookIdA: string, bookIdB: string): boolean {
  const row = db().prepare(
    `SELECT id FROM manual_overrides
     WHERE type = 'not_duplicate'
       AND ((book_id_a = ? AND book_id_b = ?) OR (book_id_a = ? AND book_id_b = ?))`
  ).get(bookIdA, bookIdB, bookIdB, bookIdA);
  return !!row;
}

export function isNotInSeries(bookId: string, seriesId: string): boolean {
  const row = db().prepare(
    "SELECT id FROM manual_overrides WHERE type = 'not_in_series' AND book_id_a = ? AND series_id = ?"
  ).get(bookId, seriesId);
  return !!row;
}
