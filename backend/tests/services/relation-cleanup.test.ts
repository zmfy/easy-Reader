import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { deleteBookRelations, deleteUserData } from '../../src/services/relation-cleanup';

function makeDb() {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE shelf (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE reading_progress (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE bookmarks (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE book_chapter_overrides (book_id TEXT, chapter_index INTEGER);
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE book_ai_metadata (book_id TEXT);
    CREATE TABLE ai_recaps (book_id TEXT, chapter_index INTEGER, paragraph_index INTEGER, content TEXT);
    CREATE TABLE highlights (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE mind_nodes (id TEXT, user_id TEXT, book_id TEXT);
    CREATE TABLE ai_expansions (book_id TEXT, center TEXT, chapter_index INTEGER, result TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  for (const [u, b] of [['u1', 'b1'], ['u1', 'b2'], ['u2', 'b1'], ['u2', 'b3']]) {
    d.prepare('INSERT INTO shelf VALUES (?, ?, ?)').run(`${u}${b}`, u, b);
    d.prepare('INSERT INTO reading_progress VALUES (?, ?, ?)').run(`${u}${b}`, u, b);
    d.prepare('INSERT INTO bookmarks VALUES (?, ?, ?)').run(`${u}${b}`, u, b);
    d.prepare('INSERT INTO highlights VALUES (?, ?, ?)').run(`${u}${b}`, u, b);
    d.prepare('INSERT INTO mind_nodes VALUES (?, ?, ?)').run(`${u}${b}`, u, b);
  }
  for (const b of ['b1', 'b2', 'b3']) {
    d.prepare('INSERT INTO book_chapter_overrides VALUES (?, 0)').run(b);
    d.prepare('INSERT INTO book_ai_metadata VALUES (?)').run(b);
    d.prepare("INSERT INTO ai_recaps VALUES (?, 0, 0, 'x')").run(b);
    d.prepare("INSERT INTO ai_expansions VALUES (?, 'c', 0, 'x')").run(b);
  }
  d.prepare("INSERT INTO settings VALUES ('reader_prefs_u1', '{}'), ('reader_prefs_u2', '{}'), ('study_prefs_u1', '{}'), ('study_prefs_u2', '{}'), ('site_name', 'x')").run();
  return d;
}

const count = (d: Database.Database, table: string, where = '1=1') =>
  (d.prepare(`SELECT COUNT(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;

describe('deleteBookRelations', () => {
  it('removes every per-book row for the given books only', () => {
    const d = makeDb();
    deleteBookRelations(d, ['b1', 'b2']);
    for (const t of ['shelf', 'reading_progress', 'bookmarks', 'book_chapter_overrides', 'book_ai_metadata', 'ai_recaps', 'highlights', 'mind_nodes', 'ai_expansions']) {
      expect(count(d, t, "book_id IN ('b1','b2')")).toBe(0);
      expect(count(d, t, "book_id = 'b3'")).toBeGreaterThan(0);
    }
  });

  it("also removes the deleted books' listening cache", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-'));
    const old = process.env.DATA_DIR;
    process.env.DATA_DIR = dataDir;
    try {
      for (const b of ['b1', 'b3']) fs.mkdirSync(path.join(dataDir, 'tts-cache', b), { recursive: true });
      deleteBookRelations(makeDb(), ['b1']);
      expect(fs.existsSync(path.join(dataDir, 'tts-cache', 'b1'))).toBe(false);
      expect(fs.existsSync(path.join(dataDir, 'tts-cache', 'b3'))).toBe(true);
    } finally {
      process.env.DATA_DIR = old;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('is a no-op for an empty id list', () => {
    const d = makeDb();
    deleteBookRelations(d, []);
    expect(count(d, 'shelf')).toBe(4);
  });
});

describe('deleteUserData', () => {
  it("removes the user's shelf, progress, bookmarks and reader prefs only", () => {
    const d = makeDb();
    deleteUserData(d, 'u1');
    for (const t of ['shelf', 'reading_progress', 'bookmarks', 'highlights', 'mind_nodes']) {
      expect(count(d, t, "user_id = 'u1'")).toBe(0);
      expect(count(d, t, "user_id = 'u2'")).toBe(2);
    }
    expect(count(d, 'settings', "key = 'reader_prefs_u1'")).toBe(0);
    expect(count(d, 'settings', "key = 'study_prefs_u1'")).toBe(0);
    expect(count(d, 'settings', "key IN ('reader_prefs_u2', 'study_prefs_u2', 'site_name')")).toBe(3);
  });
});
