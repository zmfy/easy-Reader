import Database from 'better-sqlite3';
import { buildAiFillPreview } from '../../src/services/ai-fill-preview';
import { aiManager } from '../../src/ai/ai-manager';
import { doubanSuggestList, fetchCoverThumbnailDataUri, downloadCover, fetchRating } from '../../src/utils/cover';

let testDb: Database.Database;
jest.mock('../../src/db', () => ({ getDb: () => testDb }));
jest.mock('../../src/utils/cover', () => ({
  doubanSuggestList: jest.fn(),
  fetchCoverThumbnailDataUri: jest.fn(),
  downloadCover: jest.fn(),
  fetchRating: jest.fn(),
  saveCoverFile: jest.fn(),
}));
jest.mock('../../src/ai/ai-manager', () => ({
  aiManager: { fillBookInfo: jest.fn() },
  isAiConfigured: jest.fn().mockReturnValue(true),
  getActivePluginName: jest.fn().mockReturnValue('deepseek'),
}));

const fill = aiManager.fillBookInfo as jest.Mock;
const suggest = doubanSuggestList as jest.Mock;
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
    CREATE TABLE book_ai_metadata (
      book_id TEXT PRIMARY KEY, recommended_tags TEXT, similar_works TEXT,
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
    title: '三国演义', author: '罗贯中', summary: '东汉末年', category: '历史', is_finished: true,
    recommended_tags: ['历史', '权谋'], similar_works: [{ title: '东周列国志', author: '冯梦龙', reason: '同为历史演义' }],
  });
  suggest.mockResolvedValue([
    { title: '三国演义', pic: 'https://img1.doubanio.com/a.jpg', subjectUrl: 'https://book.douban.com/subject/1/' },
    { title: '三国演义2', pic: 'https://img1.doubanio.com/b.jpg', subjectUrl: 'https://book.douban.com/subject/2/' },
    { title: '三国演义3', pic: 'https://img1.doubanio.com/c.jpg' },
  ]);
  thumb.mockImplementation(async (pic: string) => (pic.endsWith('b.jpg') ? undefined : `data:image/jpeg;base64,${pic}`));
});

describe('buildAiFillPreview', () => {
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

  it('does not write anything, download covers or fetch ratings', async () => {
    const before = snapshot();
    await buildAiFillPreview('b1');
    expect(snapshot()).toBe(before);
    expect(downloadCover).not.toHaveBeenCalled();
    expect(fetchRating).not.toHaveBeenCalled();
  });

  it('searches douban with the AI title and drops candidates whose thumbnail failed', async () => {
    const p = await buildAiFillPreview('b1');
    expect(suggest).toHaveBeenCalledWith('三国演义');
    expect(p.coverCandidates.map(c => c.pic)).toEqual(['https://img1.doubanio.com/a.jpg', 'https://img1.doubanio.com/c.jpg']);
    expect(p.coverCandidates[0].thumbnail).toBe('data:image/jpeg;base64,https://img1.doubanio.com/a.jpg');
    expect(p.coverCandidates[0].subjectUrl).toBe('https://book.douban.com/subject/1/');
  });

  it('still returns a preview when douban finds nothing', async () => {
    suggest.mockResolvedValue([]);
    const p = await buildAiFillPreview('b1');
    expect(p.coverCandidates).toEqual([]);
    expect(p.suggested.summary).toBe('东汉末年');
  });

  it('falls back to the cleaned file title for the douban search when AI gives no title', async () => {
    fill.mockResolvedValue({ summary: 'x' });
    await buildAiFillPreview('b1');
    expect(suggest).toHaveBeenCalledWith('三国演义');
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
});
