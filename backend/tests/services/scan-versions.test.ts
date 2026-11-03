import Database from 'better-sqlite3';
import { backfillFingerprintVersion, FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION, shouldReuseFingerprint } from '../../src/services/scan-versions';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, fingerprint TEXT,
    file_mtime REAL, fingerprint_version INTEGER, ai_fill_version INTEGER
  );`);
  return db;
}

describe('backfillFingerprintVersion', () => {
  it('stamps the legacy version on rows that already have a fingerprint', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('a','A','fp1')").run();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('b','B', NULL)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    const b = db.prepare("SELECT fingerprint_version v FROM books WHERE id='b'").get() as { v: number | null };
    expect(a.v).toBe(LEGACY_FINGERPRINT_VERSION);
    expect(b.v).toBeNull();
    // 旧算法的指纹不应被当作当前版本复用
    expect(shouldReuseFingerprint({
      existing: { fingerprint: 'fp1', fingerprint_version: a.v }, statSize: 0, statMtime: 0,
      fingerprintVersion: FINGERPRINT_VERSION, fullRescan: false,
    })).toBe(false);
    expect(FINGERPRINT_VERSION).toBeGreaterThan(LEGACY_FINGERPRINT_VERSION);
  });

  it('does not overwrite an already-set version', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint, fingerprint_version) VALUES ('a','A','fp1', 0)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    expect(a.v).toBe(0);
  });
});

describe('shouldReuseFingerprint', () => {
  const base = { fingerprint: 'fp', file_size: 100, file_mtime: 5000, fingerprint_version: FINGERPRINT_VERSION };
  const call = (over: Partial<Parameters<typeof shouldReuseFingerprint>[0]>) =>
    shouldReuseFingerprint({ existing: base, statSize: 100, statMtime: 5000, fingerprintVersion: FINGERPRINT_VERSION, fullRescan: false, ...over });

  it('reuses when version+size+mtime all match', () => {
    expect(call({})).toBe(true);
  });
  it('rebuilds on full_rescan', () => {
    expect(call({ fullRescan: true })).toBe(false);
  });
  it('rebuilds when no existing row', () => {
    expect(call({ existing: undefined })).toBe(false);
  });
  it('rebuilds when fingerprint missing', () => {
    expect(call({ existing: { ...base, fingerprint: undefined } })).toBe(false);
  });
  it('rebuilds when version is stale', () => {
    expect(call({ existing: { ...base, fingerprint_version: FINGERPRINT_VERSION - 1 } })).toBe(false);
  });
  it('rebuilds when file size changed', () => {
    expect(call({ statSize: 999 })).toBe(false);
  });
  it('rebuilds when mtime changed', () => {
    expect(call({ statMtime: 9999 })).toBe(false);
  });
  it('trusts a null mtime (migration leftover) and reuses', () => {
    expect(call({ existing: { ...base, file_mtime: null } })).toBe(true);
  });
  it('re-processes a garbled book even when fingerprint+size+mtime match, so improved detection can rescue it', () => {
    expect(call({ existing: { ...base, status: 'garbled' } })).toBe(false);
  });
  it('still reuses a normal book (status set, not garbled)', () => {
    expect(call({ existing: { ...base, status: 'normal' } })).toBe(true);
  });
});
