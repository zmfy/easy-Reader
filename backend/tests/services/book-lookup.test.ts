import Database from 'better-sqlite3';

jest.mock('../../src/utils/cover', () => ({
  doubanSuggestList: jest.fn(),
  searchDoubanBooks: jest.fn(),
  fetchDoubanSubjectDetail: jest.fn(),
}));
jest.mock('../../src/utils/adaptation-sources', () => ({
  searchDoubanMovies: jest.fn(),
  searchMissevanDramas: jest.fn(),
}));
jest.mock('../../src/services/adaptations', () => ({ findAdaptations: jest.fn() }));
jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { chat: jest.fn() } }));
jest.mock('../../src/services/book-lookup-agent', () => ({ runBookLookup: jest.fn() }));
jest.mock('../../src/utils/external-throttle', () => ({ throttled: jest.fn((fn: () => unknown) => fn()) }));

import { isLookupEnabled, lookupBook } from '../../src/services/book-lookup';
import { doubanSuggestList, searchDoubanBooks } from '../../src/utils/cover';
import { findAdaptations } from '../../src/services/adaptations';
import { aiManager } from '../../src/ai/ai-manager';
import { runBookLookup } from '../../src/services/book-lookup-agent';
import { throttled } from '../../src/utils/external-throttle';

const hit = (n: number, pic = true) => ({
  title: `书${n}`, author: '作者', year: '2013', ...(pic ? { pic: `https://img/${n}.jpg` } : {}), url: `https://book.douban.com/subject/${n}/`,
});
const INPUT = { fileName: 'a.txt', title: '魔戒', author: '托尔金', summary: '简介' };

let db: Database.Database;
beforeEach(() => {
  jest.clearAllMocks();
  db = new Database(':memory:');
  db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
  (doubanSuggestList as jest.Mock).mockResolvedValue([{ title: 'x', pic: 'p' }]);
  (findAdaptations as jest.Mock).mockResolvedValue([{ title: '指环王' }]);
});

describe('isLookupEnabled', () => {
  it('defaults on, only "0" turns off', () => {
    expect(isLookupEnabled(db)).toBe(true);
    db.prepare("INSERT INTO settings VALUES ('ai_lookup_enabled', '1')").run();
    expect(isLookupEnabled(db)).toBe(true);
    db.prepare("UPDATE settings SET value = '0' WHERE key = 'ai_lookup_enabled'").run();
    expect(isLookupEnabled(db)).toBe(false);
  });
});

describe('lookupBook', () => {
  it('switch off: fallback without running the agent', async () => {
    db.prepare("INSERT INTO settings VALUES ('ai_lookup_enabled', '0')").run();
    const out = await lookupBook(INPUT, db);
    expect(runBookLookup).not.toHaveBeenCalled();
    expect(doubanSuggestList).toHaveBeenCalledWith('魔戒');
    expect(findAdaptations).toHaveBeenCalledWith({ title: '魔戒', author: '托尔金', summary: '简介' }, db, { throttle: undefined });
    expect(out).toMatchObject({ usedFallback: true, noBook: false, steps: [], coverCandidates: [{ title: 'x', pic: 'p' }] });
    expect(out.confirmed).toBeUndefined();
  });

  it('agent ok: confirmed first, dedup, max 6, rating from detail, no suggest call', async () => {
    const confirmed = { hit: hit(3), title: '魔戒', detail: { tags: [], rating: 9.1 } };
    const seen = [hit(1), hit(2, false), hit(3), hit(4), hit(5), hit(6), hit(7), hit(8)];
    (runBookLookup as jest.Mock).mockResolvedValue({
      status: 'ok', confirmed, noBook: false, seenBooks: seen, adaptations: [{ title: '指环王' }], steps: [{ kind: 'invalid' }],
    });
    const out = await lookupBook(INPUT, db);
    expect(doubanSuggestList).not.toHaveBeenCalled();
    expect(out.usedFallback).toBe(false);
    expect(out.confirmed?.rating).toBe(9.1);
    expect(out.coverCandidates[0]).toEqual({ title: '书3', author: '作者', year: '2013', pic: 'https://img/3.jpg', subjectUrl: hit(3).url });
    expect(out.coverCandidates.map(c => c.subjectUrl)).toEqual([3, 1, 4, 5, 6, 7].map(n => hit(n).url));
    expect(out.adaptations).toEqual([{ title: '指环王' }]);
  });

  it('agent noBook: no confirmed, candidates from seen books', async () => {
    (runBookLookup as jest.Mock).mockResolvedValue({ status: 'ok', noBook: true, seenBooks: [hit(1)], adaptations: [], steps: [] });
    const out = await lookupBook(INPUT, db);
    expect(out.noBook).toBe(true);
    expect(out.confirmed).toBeUndefined();
    expect(out.coverCandidates).toHaveLength(1);
  });

  it('agent failed: fallback, keeps steps', async () => {
    const steps = [{ kind: 'invalid' }, { kind: 'invalid' }];
    (runBookLookup as jest.Mock).mockResolvedValue({ status: 'failed', noBook: false, seenBooks: [], adaptations: [], steps });
    const out = await lookupBook(INPUT, db);
    expect(doubanSuggestList).toHaveBeenCalled();
    expect(out.usedFallback).toBe(true);
    expect(out.steps).toEqual(steps);
    expect(out.noBook).toBe(false);
  });

  it('throttle: wraps searches and openBook; deps call real functions; chat uses low effort', async () => {
    (searchDoubanBooks as jest.Mock).mockResolvedValue([]);
    (aiManager.chat as jest.Mock).mockResolvedValue('{}');
    (runBookLookup as jest.Mock).mockImplementation(async (_i, deps) => {
      await deps.searchBook('q');
      await deps.chat('p');
      return { status: 'ok', noBook: false, seenBooks: [], adaptations: [], steps: [] };
    });
    await lookupBook(INPUT, db, { throttle: true });
    expect(throttled).toHaveBeenCalledTimes(1);
    expect(searchDoubanBooks).toHaveBeenCalledWith('q');
    expect(aiManager.chat).toHaveBeenCalledWith('p', db, { reasoningEffort: 'low' });
    (throttled as jest.Mock).mockClear();
    await lookupBook(INPUT, db);
    expect(throttled).not.toHaveBeenCalled();
  });

  it('passes onStep and isFatal to the agent; fatal chat error propagates without fallback', async () => {
    const fatal = new Error('quota');
    const isFatal = (e: unknown) => e === fatal;
    const onStep = jest.fn();
    (runBookLookup as jest.Mock).mockImplementation(async (_i, deps) => {
      expect(deps.onStep).toBe(onStep);
      expect(deps.isFatal).toBe(isFatal);
      throw fatal;
    });
    await expect(lookupBook(INPUT, db, { onStep, isFatal })).rejects.toBe(fatal);
    expect(doubanSuggestList).not.toHaveBeenCalled();
  });
});
