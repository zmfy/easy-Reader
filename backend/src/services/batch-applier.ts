import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { getDb } from '../db';
import {
  NewBookPayload,
  DuplicateGroupPayload,
  SeriesGroupPayload,
} from '../types';
import { createOverride } from './manual-override';

export interface ApplyResult {
  inserted: number;
  updated: number;
  duplicates_linked: number;
  series_created: number;
  garbled_marked: number;
  errors: Array<{ item_id: string; message: string }>;
}

/**
 * Apply a pending scan_batch to books / series tables.
 *
 * For each item:
 *  - 'new': INSERT new book
 *  - 'duplicate_group': INSERT canonical (if not exists) + each duplicate member,
 *      set duplicate_of on duplicates. Honor admin's rejected_members → mark as
 *      normal book + record manual_overrides 'not_duplicate'.
 *  - 'series': CREATE series row + UPDATE member books with series_id
 *  - 'garbled': UPDATE matching book.status = 'garbled' (book must already exist
 *      via a 'new' item in same batch or earlier)
 *  - 'encoding_fixed': UPDATE matching book.status = 'encoding_fixed'
 *
 * Returns aggregated counts. All work in a transaction.
 */
export function applyBatch(
  batchId: string,
  appliedBy: string,
  customDb?: Database.Database,
): ApplyResult {
  const db = customDb ?? getDb();
  const batch = db.prepare("SELECT * FROM scan_batches WHERE id = ? AND status = 'pending'").get(batchId) as
    | { id: string }
    | undefined;
  if (!batch) throw new Error(`Batch ${batchId} not found or not pending`);

  const items = db.prepare(
    'SELECT id, type, payload, admin_decision, admin_payload FROM scan_batch_items WHERE batch_id = ? ORDER BY type'
  ).all(batchId) as Array<{
    id: string;
    type: string;
    payload: string;
    admin_decision: string | null;
    admin_payload: string | null;
  }>;

  const result: ApplyResult = {
    inserted: 0,
    updated: 0,
    duplicates_linked: 0,
    series_created: 0,
    garbled_marked: 0,
    errors: [],
  };

  function upsertBookByPath(payload: NewBookPayload): string {
    const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(payload.file_path) as
      | { id: string }
      | undefined;
    if (existing) {
      db.prepare(
        `UPDATE books SET title = ?, fingerprint = ?, first_chapter_hash = ?, chapter_count = ?, encoding_detected = ?, status = ?, file_size = ?, file_mtime = ?, fingerprint_version = ? WHERE id = ?`
      ).run(
        payload.title,
        payload.fingerprint ?? null,
        payload.first_chapter_hash ?? null,
        payload.chapter_count ?? null,
        payload.encoding_detected ?? null,
        payload.status ?? 'normal',
        payload.file_size,
        payload.file_mtime ?? null,
        payload.fingerprint_version ?? null,
        existing.id,
      );
      result.updated++;
      return existing.id;
    }
    const id = uuidv4();
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, file_size, status, fingerprint, first_chapter_hash, chapter_count, encoding_detected, file_mtime, fingerprint_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      payload.title,
      payload.file_path,
      payload.file_format,
      payload.file_size,
      payload.status ?? 'normal',
      payload.fingerprint ?? null,
      payload.first_chapter_hash ?? null,
      payload.chapter_count ?? null,
      payload.encoding_detected ?? null,
      payload.file_mtime ?? null,
      payload.fingerprint_version ?? null,
    );
    result.inserted++;
    return id;
  }

  const tx = db.transaction(() => {
    // Phase 1: 'new'
    for (const it of items) {
      if (it.type !== 'new') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as NewBookPayload;
        upsertBookByPath(payload);
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 2: duplicate_group
    for (const it of items) {
      if (it.type !== 'duplicate_group') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as DuplicateGroupPayload & {
          rejected_members?: Array<{ file_path: string; fingerprint?: string }>;
        };

        const canonical = payload.members.find(m => m.file_path === payload.canonical_file_path);
        if (!canonical) {
          result.errors.push({ item_id: it.id, message: 'canonical member not found in members' });
          continue;
        }
        const canonicalRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(canonical.file_path) as
          | { id: string }
          | undefined;
        if (!canonicalRow) {
          const title = path.basename(canonical.file_path).replace(/\.[^.]+$/, '');
          const id = uuidv4();
          db.prepare(
            `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint, status)
             VALUES (?, ?, ?, ?, 0, ?, 'normal')`
          ).run(id, title, canonical.file_path, path.extname(canonical.file_path).slice(1).toLowerCase(), canonical.fingerprint ?? null);
          result.inserted++;
        }
        const canonicalId = (db.prepare('SELECT id FROM books WHERE file_path = ?').get(canonical.file_path) as { id: string }).id;
        db.prepare("UPDATE books SET duplicate_of = NULL, status = 'normal' WHERE id = ?").run(canonicalId);

        for (const m of payload.members) {
          if (m.file_path === canonical.file_path) continue;
          const memRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(m.file_path) as
            | { id: string }
            | undefined;
          let memId: string;
          if (memRow) {
            memId = memRow.id;
          } else {
            memId = uuidv4();
            const title = path.basename(m.file_path).replace(/\.[^.]+$/, '');
            db.prepare(
              `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint)
               VALUES (?, ?, ?, ?, 0, ?)`
            ).run(memId, title, m.file_path, path.extname(m.file_path).slice(1).toLowerCase(), m.fingerprint ?? null);
            result.inserted++;
          }
          db.prepare("UPDATE books SET status = 'duplicate', duplicate_of = ? WHERE id = ?").run(canonicalId, memId);
          result.duplicates_linked++;
        }

        // admin-rejected members → manual_overrides
        if (payload.rejected_members) {
          for (const rm of payload.rejected_members) {
            const rmRow = db.prepare('SELECT id FROM books WHERE file_path = ?').get(rm.file_path) as
              | { id: string }
              | undefined;
            let rmId: string;
            if (rmRow) {
              rmId = rmRow.id;
            } else {
              rmId = uuidv4();
              const title = path.basename(rm.file_path).replace(/\.[^.]+$/, '');
              db.prepare(
                `INSERT INTO books (id, title, file_path, file_format, file_size, fingerprint, status)
                 VALUES (?, ?, ?, ?, 0, ?, 'normal')`
              ).run(rmId, title, rm.file_path, path.extname(rm.file_path).slice(1).toLowerCase(), rm.fingerprint ?? null);
              result.inserted++;
            }
            db.prepare("UPDATE books SET status = 'normal', duplicate_of = NULL WHERE id = ?").run(rmId);
            createOverride({
              type: 'not_duplicate',
              book_id_a: canonicalId,
              book_id_b: rmId,
              created_by: appliedBy,
            });
          }
        }
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 3: series
    for (const it of items) {
      if (it.type !== 'series') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as SeriesGroupPayload & {
          rejected_members?: string[];
        };
        // Upsert: reuse existing series row with the same (name, author) to
        // avoid creating duplicate series on re-scans.
        const seriesAuthor = payload.author ?? null;
        const existingSeries = db.prepare(
          `SELECT id FROM series WHERE name = ? AND ((author IS NULL AND ? IS NULL) OR author = ?)`
        ).get(payload.series_name, seriesAuthor, seriesAuthor) as { id: string } | undefined;
        let seriesId: string;
        if (existingSeries) {
          seriesId = existingSeries.id;
        } else {
          seriesId = uuidv4();
          db.prepare(
            `INSERT INTO series (id, name, author) VALUES (?, ?, ?)`
          ).run(seriesId, payload.series_name, seriesAuthor);
          result.series_created++;
        }

        const rejectedSet = new Set(payload.rejected_members ?? []);
        for (const m of payload.members) {
          if (rejectedSet.has(m.file_path)) continue;
          const row = db.prepare('SELECT id FROM books WHERE file_path = ?').get(m.file_path) as
            | { id: string }
            | undefined;
          if (row) {
            db.prepare('UPDATE books SET series_id = ? WHERE id = ?').run(seriesId, row.id);
          }
        }

        for (const fp of rejectedSet) {
          const row = db.prepare('SELECT id FROM books WHERE file_path = ?').get(fp) as
            | { id: string }
            | undefined;
          if (row) {
            createOverride({
              type: 'not_in_series',
              book_id_a: row.id,
              series_id: seriesId,
              created_by: appliedBy,
            });
          }
        }
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    // Phase 4: garbled / encoding_fixed.
    // Garbled files are recorded in books table with status='garbled' so admin
    // can manage them via the "Problem Books" view. They are hidden from the
    // normal /library listing by the route's default status filter.
    // Disk files are NOT touched by apply — only the optional physical-delete
    // via DELETE /library/:id?with_file=true can remove disk files.
    for (const it of items) {
      if (it.type !== 'garbled' && it.type !== 'encoding_fixed') continue;
      if (it.admin_decision === 'reject') continue;
      try {
        const payload = JSON.parse(it.admin_payload ?? it.payload) as { file_path: string };
        const newStatus = it.type === 'garbled' ? 'garbled' : 'encoding_fixed';
        const r = db.prepare('UPDATE books SET status = ? WHERE file_path = ?').run(newStatus, payload.file_path);
        if (r.changes === 0 && it.type === 'garbled') {
          // No existing row — INSERT a placeholder so admin can manage it
          const title = path.basename(payload.file_path).replace(/\.[^.]+$/, '');
          const ext = path.extname(payload.file_path).slice(1).toLowerCase();
          let size = 0;
          try {
            size = require('fs').statSync(payload.file_path).size as number;
          } catch { /* file may have moved; ok */ }
          db.prepare(
            `INSERT INTO books (id, title, file_path, file_format, file_size, status)
             VALUES (?, ?, ?, ?, ?, 'garbled')`
          ).run(uuidv4(), title, payload.file_path, ext, size);
          result.inserted++;
          result.garbled_marked++;
        } else if (r.changes > 0 && it.type === 'garbled') {
          result.garbled_marked++;
        }
      } catch (e) {
        result.errors.push({ item_id: it.id, message: (e as Error).message });
      }
    }

    db.prepare(
      "UPDATE scan_batches SET status = 'applied', applied_at = CURRENT_TIMESTAMP, applied_by = ?, apply_summary = ? WHERE id = ?"
    ).run(appliedBy, JSON.stringify(result), batchId);
  });
  tx();

  return result;
}
