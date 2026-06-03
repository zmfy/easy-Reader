import Database from 'better-sqlite3';

/** Bump when the fingerprint algorithm changes → forces a full rebuild next scan. */
export const FINGERPRINT_VERSION = 1;
/** Bump when the AI-fill prompt/logic changes → forces a full re-fill next run. */
export const AI_FILL_VERSION = 1;

/**
 * One-time migration backfill: rows that already have a fingerprint (built by a
 * prior version of the app) are assumed to be at the current algorithm version.
 * Rows whose version is already set are left untouched.
 */
export function backfillFingerprintVersion(db: Database.Database): void {
  db.prepare(
    'UPDATE books SET fingerprint_version = ? WHERE fingerprint IS NOT NULL AND fingerprint_version IS NULL'
  ).run(FINGERPRINT_VERSION);
}
