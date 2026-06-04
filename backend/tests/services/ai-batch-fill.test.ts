import Database from 'better-sqlite3';
import { selectFillCandidates, stampFillVersion, authorMatchDecision, batchFill, isRateLimitError } from '../../src/services/ai-batch-fill';
import { AI_FILL_VERSION } from '../../src/services/scan-versions';
import { aiManager } from '../../src/ai/ai-manager';

// ── mock out modules that have side-effects or need real infra ──────────────

// Make getDb() return our in-memory DB (set per-test via setTestDb below).
let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({
  getDb: () => {
    if (!_testDb) throw new Error('test DB not initialised');
    return _testDb;
  },
  default: () => {
    if (!_testDb) throw new Error('test DB not initialised');
    return _testDb;
  },
}));

// No-op cover fetch – avoids real network calls.
jest.mock('../../src/utils/cover', () => ({
  fetchAndSaveCover: jest.fn().mockResolvedValue(undefined),
}));

// No-op scan-task progress – avoids needing scan_tasks table.
jest.mock('../../src/services/scan-task', () => ({
  setScanProgress: jest.fn(),
}));

// No-op audit writes – avoids needing audit_log table.
jest.mock('../../src/services/audit-log', () => ({
  writeAudit: jest.fn(),
}));

// ── shared helpers ──────────────────────────────────────────────────────────

/** Minimal books table used by the pure-function tests (no ai_fill_status). */
function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT,
    file_path TEXT, file_format TEXT, status TEXT, duplicate_of TEXT,
    ai_fill_version INTEGER
  );`);
  return d;
}

/** Full schema used by batchFill integration tests. */
function makeIntegrationDb(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      summary TEXT,
      category TEXT,
      cover_url TEXT,
      file_path TEXT NOT NULL,
      file_format TEXT NOT NULL,
      status TEXT DEFAULT 'normal',
      duplicate_of TEXT,
      ai_fill_version INTEGER,
      ai_fill_status TEXT,
      manually_edited_fields TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE book_ai_metadata (
      book_id TEXT PRIMARY KEY,
      recommended_tags TEXT,
      similar_works TEXT,
      generated_by TEXT,
      generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return d;
}

const ins = (d: Database.Database, o: Record<string, unknown>) =>
  d.prepare(`INSERT INTO books (id,title,author,summary,file_path,file_format,status,duplicate_of,ai_fill_version)
             VALUES (@id,@title,@author,@summary,@file_path,@file_format,@status,@duplicate_of,@ai_fill_version)`)
    .run({ author: null, summary: null, status: 'normal', duplicate_of: null, ai_fill_version: null, file_format: 'txt', ...o });

/** Insert a book row into the integration DB (includes ai_fill_status). */
function insBook(d: Database.Database, o: Record<string, unknown>): void {
  d.prepare(`INSERT INTO books
    (id, title, author, summary, category, cover_url, file_path, file_format,
     status, duplicate_of, ai_fill_version, ai_fill_status, manually_edited_fields)
    VALUES
    (@id, @title, @author, @summary, @category, @cover_url, @file_path, @file_format,
     @status, @duplicate_of, @ai_fill_version, @ai_fill_status, @manually_edited_fields)`)
    .run({
      author: null, summary: null, category: null, cover_url: null,
      status: 'normal', duplicate_of: null, ai_fill_version: null,
      ai_fill_status: null, manually_edited_fields: null,
      file_format: 'txt',
      ...o,
    });
}

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

describe('authorMatchDecision', () => {
  it('knownAuthor 为空 → filled', () => { expect(authorMatchDecision('', '随便')).toBe('filled'); });
  it('Pass B 作者与已知一致 → filled', () => { expect(authorMatchDecision('打眼', '打眼')).toBe('filled'); });
  it('Pass B 作者与已知不一致 → failed', () => { expect(authorMatchDecision('打眼', '唐家三少')).toBe('failed'); });
  it('Pass B 没返回作者(空) → filled', () => { expect(authorMatchDecision('打眼', '')).toBe('filled'); });
});

// ── batchFill integration tests ─────────────────────────────────────────────

describe('batchFill two-pass', () => {
  let fillSpy: jest.SpyInstance;

  beforeEach(() => {
    _testDb = makeIntegrationDb();
    fillSpy = jest.spyOn(aiManager, 'fillBookInfo');
  });

  afterEach(() => {
    fillSpy.mockRestore();
    if (_testDb) {
      _testDb.close();
      _testDb = null;
    }
  });

  /** Helper: read the ai_fill_status column from the test DB. */
  function getStatus(id: string): string | null {
    const row = _testDb!.prepare('SELECT ai_fill_status FROM books WHERE id = ?').get(id) as
      | { ai_fill_status: string | null }
      | undefined;
    return row?.ai_fill_status ?? null;
  }

  it('Pass A found → filled (single call)', async () => {
    // author is known from the row; Pass A returns non-empty result.
    insBook(_testDb!, { id: 'b1', title: '鉴宝', author: '打眼', file_path: '/nonexistent/b1.txt' });

    fillSpy.mockResolvedValueOnce({ author: '打眼', summary: '简介…' });

    const result = await batchFill({
      books: [{ id: 'b1', file_path: '/nonexistent/b1.txt', file_format: 'txt', title: '鉴宝', author: '打眼' }],
    });

    expect(getStatus('b1')).toBe('filled');
    expect(result.succeeded).toContain('b1');
    expect(result.failed).toHaveLength(0);
    // Only Pass A was called (Pass B is skipped when Pass A has data).
    expect(fillSpy).toHaveBeenCalledTimes(1);
  });

  it('Pass A empty → Pass B author mismatch → failed (two calls, fields not written)', async () => {
    insBook(_testDb!, { id: 'b2', title: '斗破苍穹', author: '打眼', file_path: '/nonexistent/b2.txt' });

    // Pass A returns nothing; Pass B returns a different author.
    fillSpy
      .mockResolvedValueOnce({})                             // Pass A: empty
      .mockResolvedValueOnce({ author: '唐家三少', summary: '某简介' }); // Pass B: mismatch

    const result = await batchFill({
      books: [{ id: 'b2', file_path: '/nonexistent/b2.txt', file_format: 'txt', title: '斗破苍穹', author: '打眼' }],
    });

    expect(getStatus('b2')).toBe('failed');
    expect(result.failed.map(f => f.book_id)).toContain('b2');
    expect(result.succeeded).not.toContain('b2');
    expect(fillSpy).toHaveBeenCalledTimes(2);

    // Fields must NOT have been written (summary stays null).
    const row = _testDb!.prepare('SELECT summary FROM books WHERE id = ?').get('b2') as
      | { summary: string | null }
      | undefined;
    expect(row?.summary).toBeNull();
  });

  it('Pass A empty → Pass B author match → filled (two calls, summary written)', async () => {
    insBook(_testDb!, { id: 'b3', title: '寻宝', author: '打眼', file_path: '/nonexistent/b3.txt' });

    // Pass A empty; Pass B returns matching author + summary.
    fillSpy
      .mockResolvedValueOnce({})                                       // Pass A: empty
      .mockResolvedValueOnce({ author: '打眼', summary: '简介内容' }); // Pass B: match

    const result = await batchFill({
      books: [{ id: 'b3', file_path: '/nonexistent/b3.txt', file_format: 'txt', title: '寻宝', author: '打眼' }],
    });

    expect(getStatus('b3')).toBe('filled');
    expect(result.succeeded).toContain('b3');
    expect(result.failed).toHaveLength(0);
    expect(fillSpy).toHaveBeenCalledTimes(2);

    // Summary must have been written.
    const row = _testDb!.prepare('SELECT summary FROM books WHERE id = ?').get('b3') as
      | { summary: string | null }
      | undefined;
    expect(row?.summary).toBe('简介内容');
  });
});

// ── isRateLimitError unit tests ─────────────────────────────────────────────

describe('isRateLimitError', () => {
  it('returns true for message containing "429"', () => {
    expect(isRateLimitError(new Error('MiniMax API error: 429 - rate_limit_error'))).toBe(true);
  });

  it('returns true for message containing "rate_limit"', () => {
    expect(isRateLimitError(new Error('rate_limit exceeded'))).toBe(true);
  });

  it('returns true for message containing "rate limit" (with space)', () => {
    expect(isRateLimitError(new Error('API rate limit reached for model'))).toBe(true);
  });

  it('returns true for message containing "Too Many Requests" (case-insensitive)', () => {
    expect(isRateLimitError(new Error('Too Many Requests'))).toBe(true);
  });

  it('returns true for too many requests (lowercase)', () => {
    expect(isRateLimitError(new Error('too many requests'))).toBe(true);
  });

  it('returns false for "book not found"', () => {
    expect(isRateLimitError(new Error('book not found'))).toBe(false);
  });

  it('returns false for generic error messages', () => {
    expect(isRateLimitError(new Error('Internal server error'))).toBe(false);
    expect(isRateLimitError(new Error('Network timeout'))).toBe(false);
  });

  it('handles non-Error objects (string)', () => {
    expect(isRateLimitError('429 rate_limit')).toBe(true);
    expect(isRateLimitError('some other string')).toBe(false);
  });
});

// ── Rate-limit transient failure tests ─────────────────────────────────────

describe('batchFill rate-limit transient failure', () => {
  let fillSpy: jest.SpyInstance;

  beforeEach(() => {
    _testDb = makeIntegrationDb();
    fillSpy = jest.spyOn(aiManager, 'fillBookInfo');
    jest.useFakeTimers();
  });

  afterEach(() => {
    fillSpy.mockRestore();
    jest.useRealTimers();
    if (_testDb) {
      _testDb.close();
      _testDb = null;
    }
  });

  it('rate-limit error leaves ai_fill_version NULL and ai_fill_status NULL (re-queuable)', async () => {
    // Book with known author → goes through Pass A path.
    insBook(_testDb!, { id: 'rl1', title: '限流书', author: '作者A', file_path: '/nonexistent/rl1.txt' });

    // All AI calls reject with a 429 rate-limit error.
    fillSpy.mockRejectedValue(new Error('MiniMax API error: 429 - rate_limit_error'));

    // Run batchFill and advance all fake timers so retry backoff completes.
    const fillPromise = batchFill({
      books: [{ id: 'rl1', file_path: '/nonexistent/rl1.txt', file_format: 'txt', title: '限流书', author: '作者A' }],
    });
    await jest.runAllTimersAsync();
    const result = await fillPromise;

    // Book must be in failed list (reported back to caller).
    expect(result.failed.map(f => f.book_id)).toContain('rl1');
    expect(result.succeeded).not.toContain('rl1');

    // ai_fill_version must NOT have been stamped (transient → re-queuable).
    const row = _testDb!.prepare('SELECT ai_fill_version, ai_fill_status FROM books WHERE id = ?').get('rl1') as
      | { ai_fill_version: number | null; ai_fill_status: string | null }
      | undefined;
    expect(row?.ai_fill_version).toBeNull();

    // ai_fill_status must NOT be 'failed' (transient → not permanently marked).
    expect(row?.ai_fill_status).toBeNull();
  });

  it('non-rate-limit error DOES stamp version and marks ai_fill_status=failed', async () => {
    insBook(_testDb!, { id: 'err1', title: '普通错误书', author: '作者B', file_path: '/nonexistent/err1.txt' });

    // Non-rate-limit error: linear backoff (1.5s, 3s, 4.5s) — advance fake timers.
    fillSpy.mockRejectedValue(new Error('Internal server error'));

    const fillPromise = batchFill({
      books: [{ id: 'err1', file_path: '/nonexistent/err1.txt', file_format: 'txt', title: '普通错误书', author: '作者B' }],
    });
    await jest.runAllTimersAsync();
    const result = await fillPromise;

    expect(result.failed.map(f => f.book_id)).toContain('err1');

    const row = _testDb!.prepare('SELECT ai_fill_version, ai_fill_status FROM books WHERE id = ?').get('err1') as
      | { ai_fill_version: number | null; ai_fill_status: string | null }
      | undefined;
    // Permanent failure: version IS stamped and status IS 'failed'.
    expect(row?.ai_fill_version).toBe(AI_FILL_VERSION);
    expect(row?.ai_fill_status).toBe('failed');
  });
});
