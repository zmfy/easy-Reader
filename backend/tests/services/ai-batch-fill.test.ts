import Database from 'better-sqlite3';
import { selectFillCandidates, stampFillVersion, authorMatchDecision, batchFill, isRateLimitError, isQuotaError, isAuthError, resetAllFills, FillBatchSummary, MAX_CONSECUTIVE_FAILURES } from '../../src/services/ai-batch-fill';
import { AI_FILL_VERSION } from '../../src/services/scan-versions';
import { aiManager } from '../../src/ai/ai-manager';
import { doubanSuggest, downloadCover, fetchRating } from '../../src/utils/cover';
import { isCancelled } from '../../src/services/scan-task';

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

jest.mock('../../src/utils/cover', () => ({
  doubanSuggest: jest.fn().mockResolvedValue(undefined),
  downloadCover: jest.fn().mockResolvedValue(undefined),
  fetchRating: jest.fn().mockResolvedValue(undefined),
}));

// No-op scan-task progress – avoids needing scan_tasks table.
// isCancelled defaults to false (not cancelled) so existing tests run fully.
jest.mock('../../src/services/scan-task', () => ({
  setScanProgress: jest.fn(),
  isCancelled: jest.fn().mockReturnValue(false),
}));

// No-op audit writes – avoids needing audit_log table.
// 后台查改编作品会访问外网，测试里替换掉
jest.mock('../../src/services/adaptations', () => ({
  ...jest.requireActual('../../src/services/adaptations'),
  findAdaptations: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/audit-log', () => ({
  writeAudit: jest.fn(),
}));

// ── shared helpers ──────────────────────────────────────────────────────────

/** Minimal books table used by the pure-function tests. */
function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE books (
    id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT,
    file_path TEXT, file_format TEXT, status TEXT, duplicate_of TEXT,
    ai_fill_version INTEGER, ai_fill_status TEXT, ai_reviewed_at DATETIME
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
      rating REAL,
      file_path TEXT NOT NULL,
      file_format TEXT NOT NULL,
      status TEXT DEFAULT 'normal',
      duplicate_of TEXT,
      ai_fill_version INTEGER,
      ai_fill_status TEXT,
      manually_edited_fields TEXT,
      content_mismatch TEXT,
      ai_reviewed_at DATETIME
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, batch_no INTEGER, apply_job_id TEXT);
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
    (id, title, author, summary, category, cover_url, rating, file_path, file_format,
     status, duplicate_of, ai_fill_version, ai_fill_status, manually_edited_fields)
    VALUES
    (@id, @title, @author, @summary, @category, @cover_url, @rating, @file_path, @file_format,
     @status, @duplicate_of, @ai_fill_version, @ai_fill_status, @manually_edited_fields)`)
    .run({
      author: null, summary: null, category: null, cover_url: null, rating: null,
      status: 'normal', duplicate_of: null, ai_fill_version: null,
      ai_fill_status: null, manually_edited_fields: null,
      file_format: 'txt',
      ...o,
    });
}

describe('selectFillCandidates', () => {
  it('includes books not yet filled at current version', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a' });
    ins(d, { id: 'b', title: 'B', author: '作者', summary: '简介', file_path: '/b', ai_fill_version: AI_FILL_VERSION });
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

  it('version-driven: includes a fully-filled book whose ai_fill_version is NULL', () => {
    const d = db();
    ins(d, { id: 'f', title: 'F', author: '作者', summary: '简介', file_path: '/f' });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).toContain('f');
  });

  it('审核过的书即使版本号过期也跳过；重置全部填充记录后重新进入', () => {
    const d = db();
    ins(d, { id: 'r', title: 'R', file_path: '/r', ai_fill_version: AI_FILL_VERSION - 1 });
    ins(d, { id: 's', title: 'S', file_path: '/s' });
    d.prepare("UPDATE books SET ai_reviewed_at = CURRENT_TIMESTAMP WHERE id = 'r'").run();
    expect(selectFillCandidates(d, false).map(r => r.id)).toEqual(['s']);
    resetAllFills(d);
    expect(selectFillCandidates(d, false).map(r => r.id).sort()).toEqual(['r', 's']);
  });

  it('version-driven: excludes a book stamped at the current version', () => {
    const d = db();
    ins(d, { id: 'g', title: 'G', file_path: '/g', ai_fill_version: AI_FILL_VERSION });
    const ids = selectFillCandidates(d, false).map(r => r.id);
    expect(ids).not.toContain('g');
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

  it('writes cover_url and rating fetched from douban during fill', async () => {
    insBook(_testDb!, { id: 'cv1', title: '有封面的书', author: '某作者', file_path: '/nonexistent/cv1.txt' });
    fillSpy.mockResolvedValueOnce({ author: '某作者', summary: '简介…' });
    (doubanSuggest as jest.Mock).mockResolvedValueOnce({ url: 'https://book.douban.com/subject/1/', pic: 'x/spic/y.jpg' });
    (downloadCover as jest.Mock).mockResolvedValueOnce('/covers/cv1.jpg');
    (fetchRating as jest.Mock).mockResolvedValueOnce(8.5);

    await batchFill({ books: [{ id: 'cv1', file_path: '/nonexistent/cv1.txt', file_format: 'txt', title: '有封面的书', author: '某作者' }] });

    const row = _testDb!.prepare('SELECT cover_url, rating FROM books WHERE id = ?').get('cv1') as { cover_url: string | null; rating: number | null };
    expect(row.cover_url).toBe('/covers/cv1.jpg');
    expect(row.rating).toBe(8.5);
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

  it('does not auto-write low-confidence fields (only guessed from title)', async () => {
    insBook(_testDb!, { id: 'lc', title: '克莱因文集', file_path: '/nonexistent/lc.epub', file_format: 'epub' });
    fillSpy.mockResolvedValueOnce({
      author: '误道者', summary: '编造的简介', category: '心理学',
      confidence: { author: 'low', summary: 'low', category: 'high' },
    });

    await batchFill({ books: [{ id: 'lc', file_path: '/nonexistent/lc.epub', file_format: 'epub', title: '克莱因文集' }] });

    const row = _testDb!.prepare('SELECT author, summary, category FROM books WHERE id = ?').get('lc');
    expect(row).toEqual({ author: null, summary: null, category: '社科/心理学' });  // 末级名补全为分类路径
    // 证据里带文件名（文件不存在也不报错）
    expect(fillSpy.mock.calls[0][0]).toContain('【文件名】lc.epub');
  });
});

// ── isRateLimitError unit tests ─────────────────────────────────────────────

describe('batchFill cancellation', () => {
  let fillSpy: jest.SpyInstance;
  beforeEach(() => {
    _testDb = makeIntegrationDb();
    fillSpy = jest.spyOn(aiManager, 'fillBookInfo');
    (isCancelled as jest.Mock).mockReturnValue(false);
  });
  afterEach(() => {
    fillSpy.mockRestore();
    (isCancelled as jest.Mock).mockReturnValue(false);
    if (_testDb) { _testDb.close(); _testDb = null; }
  });

  it('stops processing books once the task is cancelled (no AI calls, nothing filled)', async () => {
    insBook(_testDb!, { id: 'c1', title: 'A', file_path: '/nonexistent/c1.txt' });
    insBook(_testDb!, { id: 'c2', title: 'B', file_path: '/nonexistent/c2.txt' });
    (isCancelled as jest.Mock).mockReturnValue(true);

    const result = await batchFill({
      taskId: 'task-1',
      books: [
        { id: 'c1', file_path: '/nonexistent/c1.txt', file_format: 'txt', title: 'A' },
        { id: 'c2', file_path: '/nonexistent/c2.txt', file_format: 'txt', title: 'B' },
      ],
    });

    expect(isCancelled).toHaveBeenCalledWith('task-1');
    expect(fillSpy).not.toHaveBeenCalled();
    expect(result.succeeded).toHaveLength(0);
  });
});

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

describe('resetAllFills', () => {
  it('clears ai_fill_version and ai_fill_status for all stamped books, returns count', () => {
    const d = db();
    ins(d, { id: 'a', title: 'A', file_path: '/a', ai_fill_version: AI_FILL_VERSION });
    ins(d, { id: 'b', title: 'B', file_path: '/b' });
    d.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = 'a'").run();
    const n = resetAllFills(d);
    const a = d.prepare("SELECT ai_fill_version v, ai_fill_status s FROM books WHERE id='a'").get() as { v: number | null; s: string | null };
    expect(a.v).toBeNull();
    expect(a.s).toBeNull();
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('batchFill suggestions and content mismatch', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { findAdaptations } = require('../../src/services/adaptations');
  let fillSpy: jest.SpyInstance;

  beforeEach(() => {
    _testDb = makeIntegrationDb();
    fillSpy = jest.spyOn(aiManager, 'fillBookInfo');
    (findAdaptations as jest.Mock).mockReset().mockResolvedValue([]);
  });
  afterEach(() => { fillSpy.mockRestore(); _testDb?.close(); _testDb = null; });

  const book = (o: Record<string, unknown> = {}) =>
    insBook(_testDb!, { id: 'b1', title: '西游记', file_path: '/nonexistent/b1.txt', ...o });
  const run = () => batchFill({ books: [{ id: 'b1', file_path: '/nonexistent/b1.txt', file_format: 'txt', title: '西游记' }] });
  const row = () => _testDb!.prepare('SELECT author, summary, category, content_mismatch FROM books WHERE id = ?').get('b1') as Record<string, string | null>;
  const suggestion = () => {
    const r = _testDb!.prepare('SELECT data FROM ai_suggestions WHERE book_id = ?').get('b1') as { data: string } | undefined;
    return r ? JSON.parse(r.data) : undefined;
  };

  it('auto-fills empty confident fields and queues the rest (changes, low confidence, locked, tags, adaptations)', async () => {
    book({ summary: '旧简介', category: '玄幻', manually_edited_fields: '["category"]' });
    (findAdaptations as jest.Mock).mockResolvedValueOnce([
      { type: '电视剧', title: '西游记', year: '1986', source: 'douban', url: 'https://movie.douban.com/subject/1/', pic: 'https://img1.doubanio.com/p.jpg' },
    ]);
    fillSpy.mockResolvedValueOnce({
      author: '吴承恩', summary: '唐僧师徒取经', category: '小说/中国古典小说',
      recommended_tags: ['神魔'], similar_works: [{ title: '封神演义' }],
      confidence: { author: 'high', summary: 'medium', category: 'high' },
      evidence: { summary: '正文开篇' },
    });
    await run();

    expect(row()).toMatchObject({ author: '吴承恩', summary: '旧简介', category: '玄幻', content_mismatch: null });
    const s = suggestion();
    expect(s.fields.author).toBeUndefined();                     // 已自动写入
    expect(s.fields.summary).toMatchObject({ value: '唐僧师徒取经', current: '旧简介', confidence: 'medium', evidence: '正文开篇' });
    expect(s.fields.category).toMatchObject({ value: '小说/中国古典小说', current: '玄幻', locked: true });
    expect(s.recommended_tags).toEqual(['神魔']);
    expect(s.similar_works).toEqual([{ title: '封神演义' }]);
    expect(s.adaptations).toEqual([{ type: '电视剧', title: '西游记', year: '1986', source: 'douban', url: 'https://movie.douban.com/subject/1/' }]);
    // 标签不再直接写库
    expect(_testDb!.prepare('SELECT COUNT(*) AS n FROM book_ai_metadata').get()).toEqual({ n: 0 });
    // 后台查改编作品走限速
    expect((findAdaptations as jest.Mock).mock.calls[0][2]).toEqual({ throttle: true });
  });

  it('writes nothing automatically when the content is a different book, and records the mismatch', async () => {
    book({ author: null });
    fillSpy.mockResolvedValueOnce({
      title: '西游记', author: '爱潜水的乌贼', category: '小说/网络小说/玄幻',
      filename_matches: false, content_title: '诡秘之主', mismatch_reason: '正文是诡秘之主',
      confidence: { title: 'high', author: 'high', category: 'high' },
    });
    await run();
    expect(row().author).toBeNull();
    expect(JSON.parse(row().content_mismatch!)).toEqual({ title: '诡秘之主', author: '爱潜水的乌贼', reason: '正文是诡秘之主' });
    expect(suggestion().fields.author).toMatchObject({ value: '爱潜水的乌贼', current: null });
    // 按正文实际的书名查改编作品
    expect((findAdaptations as jest.Mock).mock.calls[0][0]).toMatchObject({ title: '诡秘之主', author: '爱潜水的乌贼' });
  });

  it('stores no suggestion when everything already matches', async () => {
    book({ author: '吴承恩', summary: '简介', category: '小说/中国古典小说' });
    fillSpy.mockResolvedValueOnce({ author: '吴承恩', summary: '简介', category: '小说/中国古典小说' });
    await run();
    expect(suggestion()).toBeUndefined();
  });
});


describe('isQuotaError', () => {
  it.each([
    'DeepSeek API error: 402',
    'MiniMax API error: status_code=1008 - insufficient balance',
    'MiniMax API error: 429 - {"base_resp":{"status_code":2056,"status_msg":"usage limit exceeded"}}',
    'You exceeded your current quota, please check your plan',
    '账户余额不足',
  ])('识别额度用完：%s', (m) => {
    expect(isQuotaError(new Error(m))).toBe(true);
  });
  it.each(['MiniMax API error: 429 - rate limit', 'DeepSeek API error: 500', 'fetch failed'])('其他错误不算：%s', (m) => {
    expect(isQuotaError(new Error(m))).toBe(false);
  });
});

describe('batchFill 额度暂停 / 熔断 / 分批', () => {
  let fillSpy: jest.SpyInstance;
  let timeoutSpy: jest.SpyInstance;
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `q${i + 1}`);
  const books = (list: string[]) => list.map(id => ({ id, file_path: `/nonexistent/${id}.txt`, file_format: 'txt', title: `书${id}` }));
  const status = (id: string) =>
    _testDb!.prepare('SELECT ai_fill_status AS s, ai_fill_version AS v FROM books WHERE id = ?').get(id) as { s: string | null; v: number | null };

  beforeEach(() => {
    _testDb = makeIntegrationDb();
    // 顺序处理，结果可预期
    _testDb.prepare("INSERT INTO settings (key, value) VALUES ('ai_fill_concurrency', '1')").run();
    for (const id of ids(12)) insBook(_testDb, { id, title: `书${id}`, file_path: `/nonexistent/${id}.txt` });
    fillSpy = jest.spyOn(aiManager, 'fillBookInfo');
    // 重试等待立即执行
    timeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout);
  });
  afterEach(() => {
    fillSpy.mockRestore();
    timeoutSpy.mockRestore();
    if (_testDb) { _testDb.close(); _testDb = null; }
  });

  it('额度用完立即暂停：之后的书不标失败、不盖戳，再跑一次从停下的地方继续', async () => {
    let calls = 0;
    fillSpy.mockImplementation(async () => {
      calls++;
      if (calls === 3) throw new Error('DeepSeek API error: 402');
      return { summary: '简介' };
    });
    const r = await batchFill({ books: books(ids(5)) });
    expect(r.paused?.reason).toBe('quota');
    expect(fillSpy).toHaveBeenCalledTimes(3);           // 额度错误不重试，之后的书不再调用
    expect(status('q1')).toMatchObject({ s: 'filled', v: AI_FILL_VERSION });
    expect(status('q2')).toMatchObject({ s: 'filled', v: AI_FILL_VERSION });
    for (const id of ['q3', 'q4', 'q5']) expect(status(id)).toEqual({ s: null, v: null });
    expect(r.failed).toHaveLength(0);

    // 续跑：只剩没处理的书（q3 起）
    fillSpy.mockReset();
    fillSpy.mockResolvedValue({ summary: '简介' });
    const left = selectFillCandidates(_testDb!, false).map(b => b.id).filter(id => id <= 'q5' && id.length === 2);
    expect(left).toEqual(['q3', 'q4', 'q5']);
  });

  it(`连续 ${MAX_CONSECUTIVE_FAILURES} 本出错时暂停，并撤销这一串失败标记`, async () => {
    let calls = 0;
    fillSpy.mockImplementation(async () => {
      calls++;
      if (calls === 1) return { summary: '简介' };     // q1 正常
      throw new Error('DeepSeek API error: 500');
    });
    const r = await batchFill({ books: books(ids(12)) });
    expect(r.paused?.reason).toBe('errors');
    expect(status('q1')).toMatchObject({ s: 'filled' });
    // q2..q11 连续出错 → 全部撤销，可再次填充；q12 未处理
    for (const id of ids(12).slice(1)) expect(status(id)).toEqual({ s: null, v: null });
    expect(r.failed).toHaveLength(0);
  });

  it('密钥无效（401）第一本就暂停，不标失败', async () => {
    fillSpy.mockRejectedValue(new Error('MiniMax API error: 401 - {"error":{"type":"authorized_error"}}'));
    const r = await batchFill({ books: books(ids(5)) });
    expect(r.paused?.reason).toBe('auth');
    expect(fillSpy).toHaveBeenCalledTimes(1);
    for (const id of ids(5)) expect(status(id)).toEqual({ s: null, v: null });
    expect(isAuthError(new Error('DeepSeek API error: 500'))).toBe(false);
  });

  it('熔断撤销的失败不计入批次通知', async () => {
    let calls = 0;
    fillSpy.mockImplementation(async () => {
      calls++;
      if (calls === 1) return { summary: '简介' };   // q1 正常，q2..q11 连续出错触发熔断
      throw new Error('DeepSeek API error: 500');
    });
    const done: FillBatchSummary[] = [];
    await batchFill({ books: books(ids(12)), batchSize: 2, onBatchDone: s => done.push(s) });
    expect(done.map(d => [d.processed, d.failed])).toEqual([[1, 0]]);
  });

  it('偶发出错不触发熔断，书照常标为失败', async () => {
    let calls = 0;
    fillSpy.mockImplementation(async () => {
      calls++;
      if (calls >= 2 && calls <= 5) throw new Error('DeepSeek API error: 500');   // 只有 q2（含 3 次重试）出错
      return { summary: '简介' };
    });
    const r = await batchFill({ books: books(ids(4)) });
    expect(r.paused).toBeUndefined();
    expect(status('q2')).toMatchObject({ s: 'failed', v: AI_FILL_VERSION });
    expect(status('q3')).toMatchObject({ s: 'filled' });
  });

  it('每满一批回调一次，建议记入对应批次号；批次号全局递增', async () => {
    fillSpy.mockImplementation(async () => ({ author: '某人', summary: '简介', confidence: { author: 'low' } }));
    const done: FillBatchSummary[] = [];
    await batchFill({ books: books(ids(5)), batchSize: 2, onBatchDone: s => done.push(s) });
    expect(done.map(d => [d.batch_no, d.processed])).toEqual([[1, 2], [2, 2], [3, 1]]);
    expect(done[0]).toMatchObject({ auto_filled: 2, suggested: 2 });   // 简介自动写入，低置信作者进待确认
    const rows = _testDb!.prepare('SELECT book_id, batch_no FROM ai_suggestions ORDER BY book_id').all();
    expect(rows).toEqual([
      { book_id: 'q1', batch_no: 1 }, { book_id: 'q2', batch_no: 1 },
      { book_id: 'q3', batch_no: 2 }, { book_id: 'q4', batch_no: 2 }, { book_id: 'q5', batch_no: 3 },
    ]);
    // 下一次填充接着编号
    const more: FillBatchSummary[] = [];
    await batchFill({ books: books(['q6']), batchSize: 2, onBatchDone: s => more.push(s) });
    expect(more[0].batch_no).toBe(4);
  });
});
