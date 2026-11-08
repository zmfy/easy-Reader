import Database from 'better-sqlite3';
import { buildManifest, getLastReadBookId } from '../../src/services/pwa';

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE reading_progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, book_id));`);
  return db;
}
const progress = (db: Database.Database, user: string, book: string, at: string) =>
  db.prepare('INSERT INTO reading_progress (id, user_id, book_id, updated_at) VALUES (?, ?, ?, ?)').run(`${user}-${book}`, user, book, at);

describe('pwa', () => {
  it('buildManifest clips short_name and falls back to 简单书房', () => {
    const m = buildManifest('  ');
    expect(m).toMatchObject({
      name: '简单书房', short_name: '简单书房', start_url: '/continue', scope: '/', display: 'standalone',
      theme_color: '#4338ca', background_color: '#eef1f6', lang: 'zh-CN',
    });
    const long = buildManifest('我的超级无敌家庭书房"与<资料>库🙂');
    expect(Array.from(long.short_name as string)).toHaveLength(12);
    expect(JSON.parse(JSON.stringify(long)).name).toBe('我的超级无敌家庭书房"与<资料>库🙂');
    const icons = m.icons as Array<{ src: string; sizes: string; purpose?: string }>;
    expect(icons.map(i => i.src)).toEqual(['/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']);
    expect(icons.find(i => i.purpose === 'maskable')?.sizes).toBe('512x512');
  });

  it('getLastReadBookId returns the most recently updated progress of an existing book', () => {
    const db = makeDb();
    db.exec("INSERT INTO books (id) VALUES ('b1'), ('b2'), ('b3')");
    progress(db, 'u1', 'b1', '2026-11-01 10:00:00');
    progress(db, 'u1', 'b2', '2026-11-05 10:00:00');
    progress(db, 'u2', 'b3', '2026-11-07 10:00:00');
    expect(getLastReadBookId(db, 'u1')).toBe('b2');
    expect(getLastReadBookId(db, 'u3')).toBeNull();
  });

  it('getLastReadBookId skips deleted books', () => {
    const db = makeDb();
    db.exec("INSERT INTO books (id) VALUES ('b1')");
    progress(db, 'u1', 'b1', '2026-11-01 10:00:00');
    progress(db, 'u1', 'bX', '2026-11-06 10:00:00');
    expect(getLastReadBookId(db, 'u1')).toBe('b1');
    db.exec("DELETE FROM books");
    expect(getLastReadBookId(db, 'u1')).toBeNull();
  });
});
