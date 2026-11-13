import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-skips-'));
process.env.DATA_DIR = DATA;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getDb } = require('../../src/db');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isSkippedUnchanged, recordSkip, clearSkip } = require('../../src/services/scan-skips');

describe('损坏 EPUB 数据库迁移', () => {
  it('books 新增两列，scan_skipped_files 表存在，重复迁移不报错', () => {
    const db = getDb();
    const cols = (db.prepare('PRAGMA table_info(books)').all() as Array<{ name: string }>).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['health_check_version', 'damage_reason']));
    const skipCols = (db.prepare('PRAGMA table_info(scan_skipped_files)').all() as Array<{ name: string }>).map(c => c.name);
    expect(skipCols).toEqual(expect.arrayContaining(['file_path', 'file_size', 'file_mtime', 'skipped_at']));
    db.close();
    jest.resetModules();
    const again = require('../../src/db').getDb();
    expect(() => again.prepare('SELECT damage_reason, health_check_version FROM books').all()).not.toThrow();
  });
});

describe('scan-skips', () => {
  it('记录后同大小同 mtime 视为没变，大小或 mtime 变了则否，clearSkip 后失效', () => {
    const db: Database.Database = require('../../src/db').getDb();
    expect(isSkippedUnchanged(db, '/b/a.epub', 100, 5.5)).toBe(false);
    recordSkip(db, { file_path: '/b/a.epub', file_size: 100, file_mtime: 5.5 });
    expect(isSkippedUnchanged(db, '/b/a.epub', 100, 5.5)).toBe(true);
    expect(isSkippedUnchanged(db, '/b/a.epub', 101, 5.5)).toBe(false);
    expect(isSkippedUnchanged(db, '/b/a.epub', 100, 6)).toBe(false);
    recordSkip(db, { file_path: '/b/a.epub', file_size: 101, file_mtime: 6 });
    expect(isSkippedUnchanged(db, '/b/a.epub', 101, 6)).toBe(true);
    expect(isSkippedUnchanged(db, '/b/a.epub', 100, 5.5)).toBe(false);
    clearSkip(db, '/b/a.epub');
    expect(isSkippedUnchanged(db, '/b/a.epub', 101, 6)).toBe(false);
  });
});
