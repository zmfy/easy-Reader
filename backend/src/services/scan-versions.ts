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

export interface ReuseCheckInput {
  existing?: {
    fingerprint?: string | null;
    file_size?: number | null;
    file_mtime?: number | null;
    fingerprint_version?: number | null;
  };
  statSize: number;
  statMtime: number;
  fingerprintVersion: number;
  fullRescan: boolean;
}

/**
 * Decide whether an on-disk file can reuse its stored fingerprint instead of
 * being re-read and re-hashed. Reuse requires: not a full rescan, an existing
 * row with a fingerprint at the current algorithm version, matching file size,
 * and matching mtime — except a NULL stored mtime (migration leftover) is
 * trusted so an upgraded library doesn't force a one-time full re-read.
 */
export function shouldReuseFingerprint(i: ReuseCheckInput): boolean {
  if (i.fullRescan) return false;
  const e = i.existing;
  if (!e || !e.fingerprint) return false;
  if (e.fingerprint_version !== i.fingerprintVersion) return false;
  if (e.file_size !== i.statSize) return false;
  if (e.file_mtime != null && e.file_mtime !== i.statMtime) return false;
  return true;
}
