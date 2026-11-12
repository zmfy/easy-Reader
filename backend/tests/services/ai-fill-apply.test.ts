import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { applyAiFill, AiFillApplyInput } from '../../src/services/ai-fill-apply';
import { downloadCoverFromPic, fetchRating } from '../../src/utils/cover';
import { AI_FILL_VERSION } from '../../src/services/scan-versions';

let testDb: Database.Database;
jest.mock('../../src/db', () => ({ getDb: () => testDb }));
// 封面目录在 cover.ts 导入时由 DATA_DIR 决定：在 mock 工厂里（首次 require 前）指向临时目录。
// 只 mock 网络部分，saveCoverFile 与白名单用真实实现
jest.mock('../../src/utils/cover', () => {
  const nodeFs = jest.requireActual('fs');
  const nodeOs = jest.requireActual('os');
  const nodePath = jest.requireActual('path');
  process.env.DATA_DIR = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ai-apply-'));
  const actual = jest.requireActual('../../src/utils/cover');
  return { ...actual, downloadCoverFromPic: jest.fn(), fetchRating: jest.fn() };
});

const download = downloadCoverFromPic as jest.Mock;
const rating = fetchRating as jest.Mock;
const COVERS = () => path.join(process.env.DATA_DIR!, 'covers');

function setupDb(overrides: Record<string, unknown> = {}): void {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, summary TEXT, category TEXT,
      cover_url TEXT, rating REAL, file_path TEXT NOT NULL, file_format TEXT NOT NULL,
      is_finished INTEGER DEFAULT 0, manually_edited_fields TEXT,
      ai_fill_version INTEGER, ai_fill_status TEXT, ai_reviewed_at DATETIME
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE ai_suggestions (book_id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, batch_no INTEGER, apply_job_id TEXT);
    CREATE TABLE book_ai_metadata (
      book_id TEXT PRIMARY KEY, recommended_tags TEXT, similar_works TEXT, adaptations TEXT,
      generated_by TEXT, generated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  testDb.prepare(`INSERT INTO books (id, title, author, summary, category, cover_url, rating, file_path, file_format, is_finished, manually_edited_fields)
    VALUES (@id, @title, @author, @summary, @category, @cover_url, @rating, '/books/x.txt', 'txt', 0, @manually_edited_fields)`).run({
    id: 'b1', title: '三国演义', author: '旧作者', summary: '旧简介', category: '历史', cover_url: '/covers/b1.jpg', rating: null,
    manually_edited_fields: '["author"]', ...overrides,
  });
  testDb.prepare(`INSERT INTO book_ai_metadata (book_id, recommended_tags, similar_works) VALUES ('b1', '["旧标签"]', '[{"title":"水浒传"}]')`).run();
}

const row = () => testDb.prepare('SELECT * FROM books WHERE id = ?').get('b1') as Record<string, unknown>;
const locks = () => JSON.parse((row().manually_edited_fields as string) || '[]').sort();
const meta = () => testDb.prepare('SELECT * FROM book_ai_metadata WHERE book_id = ?').get('b1') as Record<string, string>;

function input(o: Partial<AiFillApplyInput> = {}): AiFillApplyInput {
  return {
    author: '旧作者', summary: '旧简介', category: '历史',
    recommended_tags: ['旧标签'], similar_works: [{ title: '水浒传' }],
    cover: { type: 'keep' },
    suggested: { author: '罗贯中', summary: 'AI 简介', category: '古典小说' },
    ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDb();
  for (const f of fs.readdirSync(COVERS())) fs.rmSync(path.join(COVERS(), f));
});

describe('applyAiFill field and lock rules', () => {
  it('unlocks a locked field switched to the AI value', async () => {
    await applyAiFill('b1', input({ author: '罗贯中' }));
    expect(row().author).toBe('罗贯中');
    expect(locks()).toEqual([]);
  });

  it('writes and locks a field the user edited by hand', async () => {
    await applyAiFill('b1', input({ summary: '我自己写的简介' }));
    expect(row().summary).toBe('我自己写的简介');
    expect(locks()).toEqual(['author', 'summary']);
  });

  it('accepts an AI value without locking it', async () => {
    await applyAiFill('b1', input({ summary: 'AI 简介' }));
    expect(row().summary).toBe('AI 简介');
    expect(locks()).toEqual(['author']);
  });

  it('leaves a field equal to the current value untouched', async () => {
    await applyAiFill('b1', input());
    expect(row()).toMatchObject({ author: '旧作者', summary: '旧简介', category: '历史' });
    expect(locks()).toEqual(['author']);
  });

  it('ignores whitespace-only differences from the current value (no write, no lock)', async () => {
    setupDb({ summary: '旧简介\n', manually_edited_fields: '[]' });
    await applyAiFill('b1', input({ summary: '旧简介', suggested: {} }));
    expect(row().summary).toBe('旧简介\n');
    expect(locks()).toEqual([]);
  });

  it('writes is_finished when provided', async () => {
    await applyAiFill('b1', input({ is_finished: true }));
    expect(row().is_finished).toBe(1);
  });
});

describe('applyAiFill metadata', () => {
  it('replaces tags and similar works exactly, clearing them when emptied', async () => {
    await applyAiFill('b1', input({ recommended_tags: [], similar_works: [] }), 'deepseek');
    expect(JSON.parse(meta().recommended_tags || '[]')).toEqual([]);
    expect(JSON.parse(meta().similar_works || '[]')).toEqual([]);
  });

  it('stores the submitted lists', async () => {
    await applyAiFill('b1', input({ recommended_tags: ['权谋'], similar_works: [{ title: '东周列国志', author: '冯梦龙' }] }), 'deepseek');
    expect(JSON.parse(meta().recommended_tags)).toEqual(['权谋']);
    expect(JSON.parse(meta().similar_works)).toEqual([{ title: '东周列国志', author: '冯梦龙' }]);
    expect(meta().generated_by).toBe('deepseek');
  });

  it('stores confirmed adaptations, and keeps existing ones when none are submitted', async () => {
    const list = [{ type: '电视剧' as const, title: '三国演义', year: '1994', source: 'douban' as const, url: 'https://movie.douban.com/subject/1/' }];
    await applyAiFill('b1', input({ adaptations: list }), 'deepseek');
    expect(JSON.parse(meta().adaptations)).toEqual(list);
    await applyAiFill('b1', input(), 'deepseek');
    expect(JSON.parse(meta().adaptations)).toEqual(list);
    await applyAiFill('b1', input({ adaptations: [] }), 'deepseek');
    expect(JSON.parse(meta().adaptations)).toEqual([]);
  });

  it('marks the book as AI-filled at the current version', async () => {
    await applyAiFill('b1', input());
    expect(row().ai_fill_status).toBe('filled');
    expect(row().ai_fill_version).toBe(AI_FILL_VERSION);
    expect(row().ai_reviewed_at).not.toBeNull();   // 审核过，之后批量填充跳过
  });
});

describe('applyAiFill covers', () => {
  it('rejects a non-douban image url and changes nothing', async () => {
    const before = JSON.stringify(row());
    await expect(applyAiFill('b1', input({ author: '罗贯中', cover: { type: 'douban', pic: 'https://evil.com/a.jpg' } })))
      .rejects.toMatchObject({ status: 422 });
    expect(JSON.stringify(row())).toBe(before);
    expect(download).not.toHaveBeenCalled();
  });

  it('fails without writing when the chosen douban cover cannot be downloaded', async () => {
    download.mockResolvedValue(undefined);
    const before = JSON.stringify(row());
    await expect(applyAiFill('b1', input({ author: '罗贯中', cover: { type: 'douban', pic: 'https://img1.doubanio.com/a.jpg' } })))
      .rejects.toMatchObject({ status: 502 });
    expect(JSON.stringify(row())).toBe(before);
  });

  it('uses the downloaded douban cover', async () => {
    download.mockResolvedValue('/covers/b1-new.jpg');
    await applyAiFill('b1', input({ cover: { type: 'douban', pic: 'https://img1.doubanio.com/a.jpg' } }));
    expect(download).toHaveBeenCalledWith('https://img1.doubanio.com/a.jpg', 'b1');
    expect(row().cover_url).toBe('/covers/b1-new.jpg');
  });

  it('generates and saves the default cover from the final title / author / category', async () => {
    await applyAiFill('b1', input({ author: '罗贯中', category: '小说/中国古典小说', cover: { type: 'default' } }));
    const url = row().cover_url as string;
    expect(url).toMatch(/^\/covers\/b1-[0-9a-z]+\.svg$/);
    const svg = fs.readFileSync(path.join(COVERS(), url.replace('/covers/', '')), 'utf-8');
    expect(svg).toContain('#e9dfc8');          // 古典 → classic 风格
    expect(svg).toContain('罗贯中 著');
  });

  it('prints the submitted cover title on the default cover', async () => {
    await applyAiFill('b1', input({ coverTitle: '红楼梦', cover: { type: 'default' } }));
    const svg = fs.readFileSync(path.join(COVERS(), (row().cover_url as string).replace('/covers/', '')), 'utf-8');
    expect(svg).toContain('红楼梦');
  });

  it('falls back to the cleaned book title when no cover title is submitted', async () => {
    setupDb({ title: '《三国演义》（精校版全本）作者：罗贯中' });
    await applyAiFill('b1', input({ category: '其他', cover: { type: 'default' } }));
    const svg = fs.readFileSync(path.join(COVERS(), (row().cover_url as string).replace('/covers/', '')), 'utf-8');
    expect(svg).toContain('>三国演义<');           // modern 风格横排整行
    expect(svg).not.toContain('精校版');
  });

  it('rejects a changed category that is not in the category tree, but keeps an unchanged legacy one', async () => {
    await expect(applyAiFill('b1', input({ category: '古典小说' }))).rejects.toThrow('分类不在分类表中');
    await expect(applyAiFill('b1', input({ category: '历史' }))).resolves.toBeTruthy();
  });

  it('keeps the current cover untouched', async () => {
    await applyAiFill('b1', input({ cover: { type: 'keep' } }));
    expect(row().cover_url).toBe('/covers/b1.jpg');
    expect(download).not.toHaveBeenCalled();
  });
});

describe('applyAiFill rating follows the cover', () => {
  const douban = { type: 'douban' as const, pic: 'https://img1.doubanio.com/a.jpg' };
  beforeEach(() => download.mockResolvedValue('/covers/b1-new.jpg'));

  it('replaces an existing rating with the chosen douban subject\'s rating', async () => {
    setupDb({ rating: 8.1 });
    rating.mockResolvedValue(9.3);
    await applyAiFill('b1', input({ cover: douban, ratingSubjectUrl: 'https://book.douban.com/subject/1019568/' }));
    expect(rating).toHaveBeenCalledWith({ url: 'https://book.douban.com/subject/1019568/' });
    expect(row().rating).toBe(9.3);
  });

  it('clears the rating when the chosen douban subject has none', async () => {
    setupDb({ rating: 8.1 });
    rating.mockResolvedValue(undefined);
    await applyAiFill('b1', input({ cover: douban, ratingSubjectUrl: 'https://book.douban.com/subject/1/' }));
    expect(row().rating).toBeNull();
  });

  it('ignores a subject url outside the allowlist and clears the old rating', async () => {
    setupDb({ rating: 8.1 });
    await applyAiFill('b1', input({ cover: douban, ratingSubjectUrl: 'https://evil.com/subject/1/' }));
    expect(rating).not.toHaveBeenCalled();
    expect(row().rating).toBeNull();
  });

  it('clears the rating when switching to the default cover', async () => {
    setupDb({ rating: 8.1 });
    await applyAiFill('b1', input({ cover: { type: 'default' }, ratingSubjectUrl: 'https://book.douban.com/subject/1/' }));
    expect(rating).not.toHaveBeenCalled();
    expect(row().rating).toBeNull();
  });

  it('keeps the rating (and does not fetch) when the cover is kept', async () => {
    setupDb({ rating: 8.1 });
    await applyAiFill('b1', input({ cover: { type: 'keep' }, ratingSubjectUrl: 'https://book.douban.com/subject/1/' }));
    expect(rating).not.toHaveBeenCalled();
    expect(row().rating).toBe(8.1);
  });
});

it('throws not-found for an unknown book', async () => {
  await expect(applyAiFill('nope', input())).rejects.toThrow(/不存在/);
});
