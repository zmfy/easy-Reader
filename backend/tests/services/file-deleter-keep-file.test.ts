import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({
  getDb: () => {
    if (!_testDb) throw new Error('test DB not initialised');
    return _testDb;
  },
}));

import { deleteBookCascade, _setRootForTesting } from '../../src/services/file-deleter';

function makeDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, file_path TEXT);
    CREATE TABLE shelf (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE reading_progress (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE bookmarks (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE book_chapter_overrides (book_id TEXT, chapter_index INTEGER);
    CREATE TABLE book_ai_metadata (book_id TEXT);
    CREATE TABLE ai_recaps (book_id TEXT, chapter_index INTEGER, paragraph_index INTEGER, content TEXT);
    CREATE TABLE highlights (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE mind_nodes (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE ai_expansions (book_id TEXT, center TEXT, chapter_index INTEGER, result TEXT);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, user_id TEXT, action TEXT, resource_id TEXT, file_path TEXT, details TEXT);
  `);
  return d;
}

describe('deleteBookCascade with keepFiles', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'deleter-keep-'));
    _setRootForTesting(root);
    _testDb = makeDb();
  });
  afterEach(() => {
    _setRootForTesting(null);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('removes the DB record and relations but leaves the file on disk', () => {
    const file = path.join(root, 'a.txt');
    fs.writeFileSync(file, 'x');
    _testDb!.prepare("INSERT INTO books VALUES ('b1', ?)").run(file);
    _testDb!.prepare("INSERT INTO shelf VALUES ('s1', 'u1', 'b1')").run();

    const r = deleteBookCascade(
      { file_path: file, book_id: 'b1', cascade_duplicate_ids: [], cascade_duplicate_paths: [], user_id: 'admin' },
      { keepFiles: true },
    );

    expect(fs.existsSync(file)).toBe(true);
    expect(r.files_deleted).toBe(0);
    expect(r.records_deleted).toBe(1);
    expect(_testDb!.prepare('SELECT COUNT(*) c FROM shelf').get()).toEqual({ c: 0 });
    expect(_testDb!.prepare('SELECT action FROM audit_log').get()).toEqual({ action: 'delete_book_record' });
  });

  it('can remove a record whose file path is outside the books root (no file is touched)', () => {
    _testDb!.prepare("INSERT INTO books VALUES ('b2', '/elsewhere/old.txt')").run();
    const r = deleteBookCascade(
      { file_path: '/elsewhere/old.txt', book_id: 'b2', cascade_duplicate_ids: [], cascade_duplicate_paths: [], user_id: 'admin' },
      { keepFiles: true },
    );
    expect(r.records_deleted).toBe(1);
  });

  it('still deletes the file when keepFiles is not set', () => {
    const file = path.join(root, 'c.txt');
    fs.writeFileSync(file, 'x');
    _testDb!.prepare("INSERT INTO books VALUES ('b3', ?)").run(file);
    const r = deleteBookCascade({ file_path: file, book_id: 'b3', cascade_duplicate_ids: [], cascade_duplicate_paths: [], user_id: 'admin' });
    expect(fs.existsSync(file)).toBe(false);
    expect(r.files_deleted).toBe(1);
    expect(_testDb!.prepare('SELECT action FROM audit_log').get()).toEqual({ action: 'delete_book_file' });
  });
});
