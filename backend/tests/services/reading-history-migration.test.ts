import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

// 升级：已有阅读进度、还没有历史表的库，启动时把读过的书补进历史
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'history-mig-'));
process.env.DATA_DIR = DATA;

it('建表时按阅读进度回填历史', () => {
  const old = new Database(path.join(DATA, 'novel-reader.db'));
  old.exec(`CREATE TABLE reading_progress (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL, chapter_index INTEGER DEFAULT 0,
    chapter_title TEXT, scroll_top INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id, book_id))`);
  old.prepare("INSERT INTO reading_progress (id, user_id, book_id, updated_at) VALUES ('p1', 'u1', 'b1', '2026-10-01 10:00:00')").run();
  old.close();

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getDb } = require('../../src/db');
  const db = getDb();
  expect(db.prepare('SELECT user_id, book_id, opened_at FROM reading_history').all())
    .toEqual([{ user_id: 'u1', book_id: 'b1', opened_at: '2026-10-01 10:00:00' }]);
});
