import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectFiles, findOrphanBookIds } from '../../src/services/scan-walker';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

describe('scan orphan detection with unreadable subdirectories', () => {
  let root: string;
  let lockedDir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-walk-'));
    fs.writeFileSync(path.join(root, 'ok.txt'), 'x');
    lockedDir = path.join(root, 'locked');
    fs.mkdirSync(lockedDir);
    fs.writeFileSync(path.join(lockedDir, 'hidden.txt'), 'x');
    fs.chmodSync(lockedDir, 0o000);
  });
  afterEach(() => {
    fs.chmodSync(lockedDir, 0o755);
    fs.rmSync(root, { recursive: true, force: true });
  });

  (isRoot ? it.skip : it)('reports unreadable directories instead of silently skipping them', () => {
    const walk = collectFiles(root);
    expect(walk.files).toEqual([path.join(root, 'ok.txt')]);
    expect(walk.unreadableDirs).toEqual([lockedDir]);
  });

  (isRoot ? it.skip : it)('does not treat books inside an unreadable directory as orphans', () => {
    const walk = collectFiles(root);
    const rows = [
      { id: 'ok', file_path: path.join(root, 'ok.txt') },
      { id: 'hidden', file_path: path.join(lockedDir, 'hidden.txt') },
      { id: 'gone', file_path: path.join(root, 'deleted.txt') },
    ];
    expect(findOrphanBookIds(rows, walk)).toEqual(['gone']);
  });
});

describe('findOrphanBookIds', () => {
  it('only matches whole directory prefixes', () => {
    const rows = [
      { id: 'a', file_path: '/books/locked/a.txt' },
      { id: 'b', file_path: '/books/locked2/b.txt' },
    ];
    expect(findOrphanBookIds(rows, { files: [], unreadableDirs: ['/books/locked'] })).toEqual(['b']);
  });
});

describe('collectFiles supported formats', () => {
  it('includes every format the reader can open (txt / epub / pdf / umd)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-formats-'));
    for (const f of ['a.txt', 'b.EPUB', 'c.pdf', 'd.umd', 'e.docx']) fs.writeFileSync(path.join(root, f), 'x');
    const names = collectFiles(root).files.map(f => path.basename(f)).sort();
    fs.rmSync(root, { recursive: true, force: true });
    expect(names).toEqual(['a.txt', 'b.EPUB', 'c.pdf', 'd.umd']);
  });
});

import Database from 'better-sqlite3';
import { removeOrphanBooks } from '../../src/services/scan-walker';

describe('removeOrphanBooks', () => {
  function makeDb() {
    const d = new Database(':memory:');
    d.exec(`
      CREATE TABLE books (id TEXT PRIMARY KEY, status TEXT, duplicate_of TEXT);
      CREATE TABLE shelf (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE reading_progress (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE bookmarks (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE book_chapter_overrides (book_id TEXT, chapter_index INTEGER);
      CREATE TABLE book_ai_metadata (book_id TEXT);
      CREATE TABLE ai_recaps (book_id TEXT, chapter_index INTEGER, paragraph_index INTEGER, content TEXT);
      CREATE TABLE highlights (id TEXT, user_id TEXT, book_id TEXT);
    `);
    d.prepare("INSERT INTO books VALUES ('A', 'normal', NULL), ('B', 'duplicate', 'A'), ('C', 'duplicate', 'X')").run();
    d.prepare("INSERT INTO shelf VALUES ('s', 'u', 'A')").run();
    return d;
  }

  it('deletes the orphan and promotes duplicates that pointed at it back to normal books', () => {
    const d = makeDb();
    removeOrphanBooks(d, ['A']);
    expect(d.prepare("SELECT id FROM books ORDER BY id").all()).toEqual([{ id: 'B' }, { id: 'C' }]);
    expect(d.prepare("SELECT status, duplicate_of FROM books WHERE id = 'B'").get()).toEqual({ status: 'normal', duplicate_of: null });
    expect(d.prepare("SELECT status, duplicate_of FROM books WHERE id = 'C'").get()).toEqual({ status: 'duplicate', duplicate_of: 'X' });
    expect(d.prepare('SELECT COUNT(*) c FROM shelf').get()).toEqual({ c: 0 });
  });
});

describe('removeOrphanBooks at scale', () => {
  it('handles more orphans than the SQLite parameter limit', () => {
    const d = new Database(':memory:');
    d.exec(`
      CREATE TABLE books (id TEXT PRIMARY KEY, status TEXT, duplicate_of TEXT);
      CREATE TABLE shelf (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE reading_progress (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE bookmarks (id TEXT, user_id TEXT, book_id TEXT);
      CREATE TABLE book_chapter_overrides (book_id TEXT, chapter_index INTEGER);
      CREATE TABLE book_ai_metadata (book_id TEXT);
      CREATE TABLE ai_recaps (book_id TEXT, chapter_index INTEGER, paragraph_index INTEGER, content TEXT);
      CREATE TABLE highlights (id TEXT, user_id TEXT, book_id TEXT);
    `);
    const ins = d.prepare("INSERT INTO books VALUES (?, 'normal', NULL)");
    const ids = Array.from({ length: 40000 }, (_, i) => `b${i}`);
    d.transaction(() => { for (const id of ids) ins.run(id); })();
    removeOrphanBooks(d, ids);
    expect(d.prepare('SELECT COUNT(*) c FROM books').get()).toEqual({ c: 0 });
  });
});
