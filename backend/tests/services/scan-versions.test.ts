import Database from 'better-sqlite3';
import { backfillFingerprintVersion, FINGERPRINT_VERSION } from '../../src/services/scan-versions';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, fingerprint TEXT,
    file_mtime REAL, fingerprint_version INTEGER, ai_fill_version INTEGER
  );`);
  return db;
}

describe('backfillFingerprintVersion', () => {
  it('stamps current version on rows that already have a fingerprint', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('a','A','fp1')").run();
    db.prepare("INSERT INTO books (id, title, fingerprint) VALUES ('b','B', NULL)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    const b = db.prepare("SELECT fingerprint_version v FROM books WHERE id='b'").get() as { v: number | null };
    expect(a.v).toBe(FINGERPRINT_VERSION);
    expect(b.v).toBeNull();
  });

  it('does not overwrite an already-set version', () => {
    const db = freshDb();
    db.prepare("INSERT INTO books (id, title, fingerprint, fingerprint_version) VALUES ('a','A','fp1', 0)").run();
    backfillFingerprintVersion(db);
    const a = db.prepare("SELECT fingerprint_version v FROM books WHERE id='a'").get() as { v: number };
    expect(a.v).toBe(0);
  });
});
