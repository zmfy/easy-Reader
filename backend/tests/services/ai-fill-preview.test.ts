import Database from 'better-sqlite3';
import { buildAiFillPreview } from '../../src/services/ai-fill-preview';
import { aiManager } from '../../src/ai/ai-manager';
import { lookupBook, LookupOutcome } from '../../src/services/book-lookup';
import { fetchCoverThumbnailDataUri, downloadCover, fetchRating } from '../../src/utils/cover';
import { getLookupProgress } from '../../src/services/lookup-progress';

let testDb: Database.Database;
jest.mock('../../src/db', () => ({ getDb: () => testDb }));
jest.mock('../../src/utils/cover', () => ({
  doubanSuggestList: jest.fn(),
  fetchCoverThumbnailDataUri: jest.fn(),
  downloadCover: jest.fn(),
  fetchRating: jest.fn(),
  saveCoverFile: jest.fn(),
}));
jest.mock('../../src/services/book-lookup', () => ({ lookupBook: jest.fn() }));
jest.mock('../../src/ai/ai-manager', () => ({
  aiManager: { fillBookInfo: jest.fn() },
  isAiConfigured: jest.fn().mockReturnValue(true),
  getActivePluginName: jest.fn().mockReturnValue('deepseek'),
}));

const fill = aiManager.fillBookInfo as jest.Mock;
const lookup = lookupBook as jest.Mock;

const outcome = (o: Record<string, unknown> = {}) => ({
  noBook: false, coverCandidates: [], adaptations: [], steps: [], usedFallback: false, ...o,
}) as LookupOutcome;
const covers = [
  { title: '三国演义', pic: 'https://img1.doubanio.com/a.jpg', subjectUrl: 'https://book.douban.com/subject/1/' },
  { title: '三国演义2', pic: 'https://img1.doubanio.com/b.jpg', subjectUrl: 'https://book.douban.com/subject/2/' },
  { title: '三国演义3', pic: 'https://img1.doubanio.com/c.jpg' },
];
const lotr = {
  hit: { title: '魔戒（全集）', author: '托尔金', year: '2009', url: 'https://book.douban.com/subject/9/', pic: 'https://img1.doubanio.com/m.jpg' },
  title: '魔戒全集', author: '[英] J.R.R.托尔金', doubanAuthor: '[英] J.R.R.托尔金 / 丁棣 译', why: '作者与译本吻合',
};
const thumb = fetchCoverThumbnailDataUri as jest.Mock;

function setupDb(): void {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, summary TEXT, category TEXT,
      cover_url TEXT, rating REAL, file_path TEXT NOT NULL, file_format TEXT NOT NULL,
      is_finished INTEGER DEFAULT 0, manually_edited_fields TEXT,
      ai_fill_version INTEGER, ai_fill_status TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, batch_no INTEGER, apply_job_id TEXT);
    CREATE TABLE book_ai_metadata (
      book_id TEXT PRIMARY KEY, recommended_tags TEXT, similar_works TEXT, adaptations TEXT,
      generated_by TEXT, generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  testDb.prepare(`INSERT INTO books (id, title, author, summary, category, cover_url, file_path, file_format, is_finished, manually_edited_fields)
    VALUES ('b1', '《三国演义》（精校版全本）', '罗贯中', '旧简介', '历史', '/covers/b1.jpg', '/books/sg.epub', 'epub', 0, '["author"]')`).run();
  testDb.prepare(`INSERT INTO book_ai_metadata (book_id, recommended_tags, similar_works) VALUES ('b1', '["旧标签"]', '[{"title":"水浒传"}]')`).run();
}

const snapshot = () => JSON.stringify([
  testDb.prepare('SELECT * FROM books').all(),
  testDb.prepare('SELECT * FROM book_ai_metadata').all(),
]);

beforeEach(() => {
  jest.clearAllMocks();
  setupDb();
  fill.mockResolvedValue({
    title: '三国演义', author: '罗贯中', summary: '东汉末年', category: '历史', is_finished: true, book_type: '小说',
    recommended_tags: ['历史', '权谋'], similar_works: [{ title: '东周列国志', author: '冯梦龙', reason: '同为历史演义' }],
  });
  lookup.mockResolvedValue(outcome({ coverCandidates: covers }));
  thumb.mockImplementation(async (pic: string) => (pic.endsWith('b.jpg') ? undefined : `data:image/jpeg;base64,${pic}`));
});

describe('buildAiFillPreview', () => {
  it('appends adaptation posters after book covers, tagged with their kind, and strips pic from the list', async () => {
    lookup.mockResolvedValueOnce(outcome({ coverCandidates: covers, adaptations: [
      { type: '电视剧', title: '三国演义', year: '1994', source: 'douban', url: 'https://movie.douban.com/subject/1/', pic: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg' },
      { type: '广播剧', title: '三国演义', source: 'missevan', url: 'https://www.missevan.com/mdrama/9' },
    ] }));
    const p = await buildAiFillPreview('b1');
    const last = p.coverCandidates[p.coverCandidates.length - 1];
    expect(last).toMatchObject({ title: '三国演义', year: '1994', kind: '电视剧', pic: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg' });
    expect(last.subjectUrl).toBeUndefined();
    expect(p.coverCandidates.filter(c => c.kind)).toHaveLength(1);
    expect(p.suggested.adaptations.every(a => !('pic' in a))).toBe(true);
  });

  it('returns current and suggested adaptations, looked up with the AI title and author', async () => {
    const found = [{ type: '电视剧', title: '三国演义', year: '1994', source: 'douban', url: 'https://movie.douban.com/subject/1/' }];
    lookup.mockResolvedValueOnce(outcome({ adaptations: found }));
    testDb.prepare(`UPDATE book_ai_metadata SET adaptations = '[{"type":"电影","title":"赤壁"}]'`).run();
    const p = await buildAiFillPreview('b1');
    expect(p.suggested.adaptations).toEqual(found);
    expect(p.current.adaptations).toEqual([{ type: '电影', title: '赤壁' }]);
    expect(lookup.mock.calls[0][0]).toMatchObject({ fileName: 'sg.epub', title: '三国演义', author: '罗贯中', summary: '东汉末年', bookType: '小说' });
    expect(lookup.mock.calls[0][0].embedded).toBeUndefined();   // 测试文件不存在，没有内置信息
  });

  it('returns per-field confidence and evidence notes', async () => {
    fill.mockResolvedValueOnce({
      author: '罗贯中', summary: '东汉末年', category: '历史',
      confidence: { author: 'high', summary: 'low' },
      evidence: { author: '版权页署名' },
    });
    const p = await buildAiFillPreview('b1');
    expect(p.suggested.confidence).toEqual({ author: 'high', summary: 'low', category: 'medium' });
    expect(p.suggested.evidence).toEqual({ author: '版权页署名' });
    expect(fill.mock.calls[0][0]).toContain('【文件名】sg.epub');
  });

  it('returns current values, AI suggestions and locked fields', async () => {
    const p = await buildAiFillPreview('b1');
    expect(p.current).toMatchObject({
      title: '《三国演义》（精校版全本）', author: '罗贯中', summary: '旧简介', category: '历史',
      is_finished: false, cover_url: '/covers/b1.jpg',
      recommended_tags: ['旧标签'], similar_works: [{ title: '水浒传' }],
    });
    expect(p.suggested).toMatchObject({
      author: '罗贯中', summary: '东汉末年', category: '历史', is_finished: true,
      recommended_tags: ['历史', '权谋'],
      similar_works: [{ title: '东周列国志', author: '冯梦龙', reason: '同为历史演义' }],
    });
    expect(p.lockedFields).toEqual(['author']);
  });

  it('provides a clean title for the default cover: AI title, else the cleaned file title', async () => {
    expect((await buildAiFillPreview('b1')).coverTitle).toBe('三国演义');
    fill.mockResolvedValue({ summary: 'x' });
    expect((await buildAiFillPreview('b1')).coverTitle).toBe('三国演义');   // 《三国演义》（精校版全本） 清洗后
  });

  it('does not write anything, download covers or fetch ratings', async () => {
    const before = snapshot();
    await buildAiFillPreview('b1');
    expect(snapshot()).toBe(before);
    expect(downloadCover).not.toHaveBeenCalled();
    expect(fetchRating).not.toHaveBeenCalled();
  });

  it('uses the lookup cover candidates and drops candidates whose thumbnail failed', async () => {
    const p = await buildAiFillPreview('b1');
    expect(p.coverCandidates.map(c => c.pic)).toEqual(['https://img1.doubanio.com/a.jpg', 'https://img1.doubanio.com/c.jpg']);
    expect(p.coverCandidates[0].thumbnail).toBe('data:image/jpeg;base64,https://img1.doubanio.com/a.jpg');
    expect(p.coverCandidates[0].subjectUrl).toBe('https://book.douban.com/subject/1/');
  });

  it('still returns a preview when douban finds nothing', async () => {
    lookup.mockResolvedValue(outcome());
    const p = await buildAiFillPreview('b1');
    expect(p.coverCandidates).toEqual([]);
    expect(p.suggested.summary).toBe('东汉末年');
  });

  it('falls back to the cleaned file title for the lookup when AI gives no title', async () => {
    fill.mockResolvedValue({ summary: 'x' });
    await buildAiFillPreview('b1');
    expect(lookup.mock.calls[0][0].title).toBe('三国演义');
  });

  it('infers is_finished from the file name when AI omits it', async () => {
    fill.mockResolvedValue({ summary: 'x' });
    const p = await buildAiFillPreview('b1');
    expect(p.suggested.is_finished).toBe(true);   // 书名含「全本」
  });

  it('appends the serialization note to the suggested summary', async () => {
    fill.mockResolvedValue({ summary: '简介', is_finished: true, start_date: '2007年12月', end_date: '2009年5月', platform: '起点中文网' });
    const p = await buildAiFillPreview('b1');
    expect(p.suggested.summary).toBe('简介\n从2007年12月开始在起点中文网连载，于2009年5月完本。');
  });

  it('throws a not-found error for an unknown book', async () => {
    await expect(buildAiFillPreview('nope')).rejects.toThrow(/不存在/);
  });

  describe('lookup', () => {
    const setTitle = (t: string) => testDb.prepare('UPDATE books SET title = ? WHERE id = ?').run(t, 'b1');
    const setAuthor = (a: string | null) => testDb.prepare('UPDATE books SET author = ? WHERE id = ?').run(a, 'b1');

    it('ignores a confirmation whose author conflicts with the current author (no author override, title or douban evidence)', async () => {
      setTitle('理智与情感');
      fill.mockResolvedValue({ title: '理智与情感', author: '忘语', summary: '修仙', evidence: { author: '文件' } });
      lookup.mockResolvedValue(outcome({ confirmed: { ...lotr, title: '魔戒' }, coverCandidates: covers }));
      testDb.prepare('UPDATE books SET author = ? WHERE id = ?').run('忘语', 'b1');
      const p = await buildAiFillPreview('b1');
      expect(p.suggested.title).toBeUndefined();
      expect(p.suggested.author).toBe('忘语');
      expect(p.suggested.confidence.title).toBeUndefined();
      expect(p.suggested.confidence.author).not.toBe('high');
      expect(p.suggested.evidence.title).toBeUndefined();
      expect(p.suggested.evidence.author).toBe('文件');
      expect(p.coverCandidates.map(c => c.title)).toEqual(['三国演义', '三国演义3']);
    });

    it('without a current author, the author in the file name is used for the conflict check', async () => {
      setTitle('理智与情感');
      setAuthor(null);
      testDb.prepare('UPDATE books SET file_path = ? WHERE id = ?').run('/books/理智与情感 作者：忘语.txt', 'b1');
      fill.mockResolvedValue({ title: '理智与情感', summary: '修仙' });
      lookup.mockResolvedValue(outcome({ confirmed: { ...lotr, title: '魔戒' } }));
      const p = await buildAiFillPreview('b1');
      expect(p.suggested.title).toBeUndefined();
      expect(p.suggested.author).toBeUndefined();
    });

    it('suggests the confirmed title when it differs from the current one, with douban evidence', async () => {
      setTitle('魔戒全集 精校版');
      setAuthor('托尔金');
      fill.mockResolvedValue({ title: '魔戒', author: '托尔金', summary: '中土', confidence: { author: 'low' } });
      lookup.mockResolvedValue(outcome({ confirmed: lotr }));
      const p = await buildAiFillPreview('b1');
      expect(p.suggested.title).toBe('魔戒全集');
      expect(p.suggested.confidence.title).toBe('high');
      expect(p.suggested.author).toBe('[英] J.R.R.托尔金');
      expect(p.suggested.confidence.author).toBe('high');
      expect(p.suggested.evidence.author).toContain('豆瓣');
      expect(p.suggested.evidence.title).toBe('豆瓣：《魔戒（全集）》[英] J.R.R.托尔金 / 丁棣 译 2009；作者与译本吻合');
    });

    it('does not suggest a title that only differs by spaces or book-title marks', async () => {
      setTitle('《魔戒 全集》');
      setAuthor(null);
      lookup.mockResolvedValue(outcome({ confirmed: lotr }));
      const p = await buildAiFillPreview('b1');
      expect(p.suggested.title).toBeUndefined();
      expect(p.suggested.confidence.title).toBe('high');
    });

    it('looks up the book the content belongs to when mismatched, and puts the confirmed result in contentMismatch', async () => {
      fill.mockResolvedValue({
        title: '三国演义', filename_matches: false, content_title: '指环王', content_author: '托尔金',
        mismatch_reason: '正文是魔戒', summary: '中土',
      });
      lookup.mockResolvedValue(outcome({ confirmed: lotr }));
      const p = await buildAiFillPreview('b1');
      expect(lookup.mock.calls[0][0]).toMatchObject({ title: '指环王', author: '托尔金', mismatchReason: '正文是魔戒' });
      expect(p.suggested.title).toBeUndefined();
      expect(p.contentMismatch).toEqual({
        title: '魔戒全集', author: '[英] J.R.R.托尔金',
        reason: '正文是魔戒；豆瓣：《魔戒（全集）》[英] J.R.R.托尔金 / 丁棣 译 2009；作者与译本吻合',
      });
    });

    it('passes the lookup trace and fallback flag through', async () => {
      const steps = [{ kind: 'search_book' as const, query: '三国演义', count: 3 }];
      lookup.mockResolvedValue(outcome({ steps, usedFallback: true }));
      const p = await buildAiFillPreview('b1');
      expect(p.lookupTrace).toEqual(steps);
      expect(p.lookupUsedFallback).toBe(true);
    });

    it('reports lookup steps as progress and marks it done afterwards', async () => {
      const steps = [{ kind: 'search_book' as const, query: '三国演义', count: 3 }];
      let during: unknown;
      lookup.mockImplementation(async (_input, _db, opts) => {
        opts.onStep(steps);
        during = getLookupProgress('b1');
        return outcome({ steps });
      });
      await buildAiFillPreview('b1');
      expect(during).toEqual({ steps, done: false });
      expect(getLookupProgress('b1')).toEqual({ steps, done: true });
    });

    it('marks progress done even when the lookup throws', async () => {
      lookup.mockRejectedValue(new Error('boom'));
      await expect(buildAiFillPreview('b1')).rejects.toThrow('boom');
      expect(getLookupProgress('b1')?.done).toBe(true);
    });

    it('reports title as a locked field', async () => {
      testDb.prepare(`UPDATE books SET manually_edited_fields = '["title","author"]'`).run();
      const p = await buildAiFillPreview('b1');
      expect(p.lockedFields).toEqual(['title', 'author']);
    });
  });
});
