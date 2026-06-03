import Database from 'better-sqlite3';
import { selectFillCandidates, stampFillVersion } from '../../src/services/ai-batch-fill';
import { AI_FILL_VERSION } from '../../src/services/scan-versions';

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT,
    file_path TEXT, file_format TEXT, status TEXT, duplicate_of TEXT,
    ai_fill_version INTEGER
  );`);
  return d;
}
const ins = (d: Database.Database, o: Record<string, unknown>) =>
  d.prepare(`INSERT INTO books (id,title,author,summary,file_path,file_format,status,duplicate_of,ai_fill_version)
             VALUES (@id,@title,@author,@summary,@file_path,@file_format,@status,@duplicate_of,@ai_fill_version)`)
    .run({ author: null, summary: null, status: 'normal', duplicate_of: null, ai_fill_version: null, file_format: 'txt', ...o });

describe('selectFillCandidates', () => {
  it('includes books missing author/summary and not yet filled at current version', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b' });
    ins(d, { id: 'c', title: 'C', file_path: '/c', ai_fill_version: AI_FILL_VERSION });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).toEqual(['a']);
  });

  it('force includes ALL normal non-duplicate books regardless of version/fields', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b', ai_fill_version: AI_FILL_VERSION });
    ins(d, { id: 'x', title: 'X', file_path: '/x', status: 'duplicate' });
    const ids = selectFillCandidates(d, true).map(r => r.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('re-includes a book stamped at a prior (lower) version', () => {
    const d = db();
    ins(d, { id: 'd', title: 'D', file_path: '/d', ai_fill_version: AI_FILL_VERSION - 1 });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).toContain('d');
  });
});

describe('stampFillVersion', () => {
  it('marks the book at current version', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    stampFillVersion(d, 'a');
    const v = (d.prepare("SELECT ai_fill_version v FROM books WHERE id='a'").get() as { v: number }).v;
    expect(v).toBe(AI_FILL_VERSION);
  });
});
