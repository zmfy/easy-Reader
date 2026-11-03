import Database from 'better-sqlite3';

let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({ getDb: () => _testDb }));
const normalizeMock = jest.fn();
jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { normalizeChapterTitles: (t: string[]) => normalizeMock(t) } }));

import { normalizeChaptersForBook, getOverridesMap } from '../../src/services/chapter-normalize';

function setup() {
  _testDb = new Database(':memory:');
  _testDb.exec('CREATE TABLE book_chapter_overrides (book_id TEXT, chapter_index INTEGER, normalized_title TEXT, PRIMARY KEY (book_id, chapter_index))');
  _testDb.prepare("INSERT INTO book_chapter_overrides VALUES ('b', 0, '旧标题0'), ('b', 45, '旧标题45')").run();
  normalizeMock.mockReset();
}

const titles = Array.from({ length: 50 }, (_, i) => `原${i}`);

describe('normalizeChaptersForBook', () => {
  beforeEach(setup);

  it('keeps existing overrides when every AI batch fails', async () => {
    normalizeMock.mockRejectedValue(new Error('AI down'));
    const r = await normalizeChaptersForBook('b', titles);
    expect(r.failed_batches).toBe(2);
    expect(getOverridesMap('b')).toEqual(new Map([[0, '旧标题0'], [45, '旧标题45']]));
  });

  it('replaces only the ranges whose batch succeeded', async () => {
    normalizeMock
      .mockImplementationOnce(async (b: string[]) => b.map(t => `新${t}`))   // 第 0–39 章成功
      .mockRejectedValueOnce(new Error('AI down'));                           // 第 40–49 章失败
    await normalizeChaptersForBook('b', titles);
    const m = getOverridesMap('b');
    expect(m.get(0)).toBe('新原0');
    expect(m.get(39)).toBe('新原39');
    expect(m.get(45)).toBe('旧标题45');
  });

  it('does not fail when two runs for the same book overlap', async () => {
    normalizeMock.mockImplementation(async (b: string[]) => { await new Promise(r => setTimeout(r, 5)); return b.map(t => `新${t}`); });
    await expect(Promise.all([normalizeChaptersForBook('b', titles), normalizeChaptersForBook('b', titles)])).resolves.toHaveLength(2);
    expect(getOverridesMap('b').size).toBe(50);
  });
});
