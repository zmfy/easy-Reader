import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'txt-organize-schema-'));
process.env.DATA_DIR = DATA;

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const { VISIBLE_BOOK_SQL } = require('../../src/services/opds-catalog');
/* eslint-enable @typescript-eslint/no-var-requires */

const db = getDb();

describe('TXT 整理：表结构', () => {
  it('新表和新列存在', () => {
    const cols = (t: string) => db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string; dflt_value: string | null }>;
    const bookCols = cols('books').map(c => c.name);
    expect(bookCols).toEqual(expect.arrayContaining(['organized_from', 'organized_job_id']));
    const kind = cols('scan_batches').find(c => c.name === 'kind');
    expect(kind).toBeDefined();
    expect(kind!.dflt_value).toBe("'scan'");
    for (const t of ['txt_organize_jobs', 'txt_organize_chapter_map', 'txt_organize_rejections']) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(t);
      expect(row).toBeDefined();
    }
  });

  it('pending_review 的书不出现在 OPDS 可见书籍里', () => {
    db.prepare(
      `INSERT INTO books (id, title, file_path, file_format, status, imported_at)
       VALUES ('pr1', 'x（整理版）', '/o/pr1.epub', 'epub', 'pending_review', '2026-11-27 00:00:00')`
    ).run();
    const n = db.prepare(`SELECT COUNT(*) AS n FROM books WHERE ${VISIBLE_BOOK_SQL}`).get() as { n: number };
    expect(n.n).toBe(0);
  });

  it('启动时 running 的整理任务回到 pending', () => {
    db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status) VALUES ('j1', 'b', 'u', 'running')").run();
    db.prepare("INSERT INTO txt_organize_jobs (id, book_id, requested_by, status) VALUES ('j2', 'b', 'u', 'review')").run();
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const again = require('../../src/db').getDb();
    const st = (id: string) => (again.prepare('SELECT status FROM txt_organize_jobs WHERE id = ?').get(id) as { status: string }).status;
    expect(st('j1')).toBe('pending');
    expect(st('j2')).toBe('review');
  });
});
