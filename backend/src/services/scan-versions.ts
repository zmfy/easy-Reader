import Database from 'better-sqlite3';

/** Bump when the fingerprint algorithm changes → forces a full rebuild next scan. */
// v2: TXT segments of chapter-less files now align to line starts and chapter
//     HTML is escaped, both of which change the first-chapter text being hashed.
export const FINGERPRINT_VERSION = 2;
/** Bump when the AI-fill prompt/logic changes → forces a full re-fill next run. */
// v2: 填充改为依据文件内置书目信息 + 正文节选（含 epub/pdf/umd），低置信字段不自动写入
// v3: 其余结果进「待确认」、后台查改编作品、判定文件名与正文是否不符
export const AI_FILL_VERSION = 3;

/** Algorithm version of fingerprints built before versioning existed. */
export const LEGACY_FINGERPRINT_VERSION = 1;

/**
 * One-time migration backfill: rows that already have a fingerprint but no
 * version were built by the legacy (v1) algorithm before versioning existed.
 * Stamp them as v1 — not the current version — so they are rebuilt whenever the
 * algorithm has moved on. Rows whose version is already set are left untouched.
 */
export function backfillFingerprintVersion(db: Database.Database): void {
  db.prepare(
    'UPDATE books SET fingerprint_version = ? WHERE fingerprint IS NOT NULL AND fingerprint_version IS NULL'
  ).run(LEGACY_FINGERPRINT_VERSION);
}

export interface ReuseCheckInput {
  existing?: {
    fingerprint?: string | null;
    file_size?: number | null;
    file_mtime?: number | null;
    fingerprint_version?: number | null;
    status?: string | null;
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
 *
 * A book currently flagged 'garbled' is NEVER reused: it keeps a fingerprint
 * from a prior run, so size/mtime would match and it would be skipped forever —
 * even after the encoding/garbled detection improves. Always re-process garbled
 * books so better detection can rescue them on the next ordinary scan.
 */
export function shouldReuseFingerprint(i: ReuseCheckInput): boolean {
  if (i.fullRescan) return false;
  const e = i.existing;
  if (!e || !e.fingerprint) return false;
  if (e.status === 'garbled') return false;
  if (e.fingerprint_version !== i.fingerprintVersion) return false;
  if (e.file_size !== i.statSize) return false;
  if (e.file_mtime != null && e.file_mtime !== i.statMtime) return false;
  return true;
}
