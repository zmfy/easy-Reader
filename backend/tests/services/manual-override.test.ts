import Database from 'better-sqlite3';
import { _setDbForTesting, createOverride, listOverridesWithNames } from '../../src/services/manual-override';

let d: Database.Database;
beforeEach(() => {
  d = new Database(':memory:');
  d.exec(`
    CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE series (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE manual_overrides (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, book_id_a TEXT, book_id_b TEXT, series_id TEXT,
      created_by TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO books VALUES ('a', '民国奇人(全10册)'), ('b', '民国奇人(全10册)(1)');
    INSERT INTO series VALUES ('s1', '斗罗大陆');
  `);
  _setDbForTesting(d);
});
afterEach(() => { _setDbForTesting(null); d.close(); });

describe('listOverridesWithNames', () => {
  it('adds book titles and series name; missing books / series come back as null', () => {
    createOverride({ type: 'not_duplicate', book_id_a: 'a', book_id_b: 'b', created_by: 'u' });
    createOverride({ type: 'not_in_series', book_id_a: 'gone', series_id: 's1', created_by: 'u' });
    const rows = listOverridesWithNames();
    const dup = rows.find(r => r.type === 'not_duplicate')!;
    expect(dup).toMatchObject({ title_a: '民国奇人(全10册)', title_b: '民国奇人(全10册)(1)', series_name: null });
    const series = rows.find(r => r.type === 'not_in_series')!;
    expect(series).toMatchObject({ title_a: null, title_b: null, series_name: '斗罗大陆' });
  });

  it('filters by type', () => {
    createOverride({ type: 'not_duplicate', book_id_a: 'a', book_id_b: 'b', created_by: 'u' });
    createOverride({ type: 'not_in_series', book_id_a: 'a', series_id: 's1', created_by: 'u' });
    expect(listOverridesWithNames('not_in_series').map(r => r.type)).toEqual(['not_in_series']);
  });
});
