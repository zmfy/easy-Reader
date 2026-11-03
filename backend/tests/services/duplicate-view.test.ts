import Database from 'better-sqlite3';
import { selectDuplicateGroupBooks } from '../../src/services/duplicate-view';

function makeDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, status TEXT, duplicate_of TEXT
  );`);
  const ins = (o: Record<string, unknown>) =>
    d.prepare('INSERT INTO books (id,title,author,status,duplicate_of) VALUES (@id,@title,@author,@status,@duplicate_of)')
      .run({ author: null, status: 'normal', duplicate_of: null, ...o });
  ins({ id: 'canon', title: '甲', status: 'normal' });
  ins({ id: 'dup1', title: '甲', status: 'duplicate', duplicate_of: 'canon' });
  ins({ id: 'dup2', title: '甲', status: 'duplicate', duplicate_of: 'canon' });
  ins({ id: 'solo', title: '乙', status: 'normal' });
  return d;
}

describe('selectDuplicateGroupBooks', () => {
  it('returns the full group: canonical + its duplicates, excludes unrelated normal books', () => {
    const d = makeDb();
    const { rows, total } = selectDuplicateGroupBooks(d, 50, 0);
    const ids = rows.map(r => (r as { id: string }).id).sort();
    expect(ids).toEqual(['canon', 'dup1', 'dup2']);
    expect(total).toBe(3);
  });
});
