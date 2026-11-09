import Database from 'better-sqlite3';
import { aiManager } from '../../src/ai/ai-manager';
import {
  listLegacyCategoryBooks, suggestLegacyCategories, applyCategories, buildCategorizePrompt, parseCategorizeResponse,
} from '../../src/services/category-migrate';
import { DEFAULT_CATEGORY_TREE } from '../../src/utils/category-tree';

jest.mock('../../src/ai/ai-manager', () => ({ aiManager: { chat: jest.fn() } }));
const chat = aiManager.chat as jest.Mock;

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT, summary TEXT, category TEXT, status TEXT DEFAULT 'normal', duplicate_of TEXT);`);
  const ins = d.prepare('INSERT INTO books (id, title, author, summary, category, status) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run('b1', '西游记', '吴承恩', '唐僧师徒取经', '玄幻', 'normal');
  ins.run('b2', '凡人修仙传', '忘语', null, '修真', 'normal');
  ins.run('b3', '克莱因文集', '梅兰妮·克莱因', null, '社科/心理学', 'normal');   // 已是合法路径
  ins.run('b4', '无分类', null, null, null, 'normal');
  ins.run('b5', '重复本', null, null, '玄幻', 'duplicate');
  return d;
}

beforeEach(() => chat.mockReset());

describe('category migration', () => {
  it('lists only normal books whose category is not a tree path', () => {
    expect(listLegacyCategoryBooks(db()).map(b => b.id)).toEqual(['b2', 'b1']);  // 按书名排序
  });

  it('maps unambiguous genres directly and asks AI (low effort) for the rest', async () => {
    chat.mockResolvedValueOnce('{"items":[{"index":0,"category":"小说/中国古典小说"}]}');
    const d = db();
    const s = await suggestLegacyCategories(d);
    expect(s.find(x => x.id === 'b2')).toMatchObject({ suggested: '小说/网络小说/仙侠修真', source: 'map' });
    expect(s.find(x => x.id === 'b1')).toMatchObject({ suggested: '小说/中国古典小说', source: 'ai' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toContain('《西游记》 | 作者：吴承恩 | 旧分类：玄幻（可能不准） | 简介：唐僧师徒取经');
    expect(chat.mock.calls[0][2]).toEqual({ reasoningEffort: 'low' });
  });

  it('leaves books without a suggestion when AI fails', async () => {
    chat.mockRejectedValueOnce(new Error('未配置 AI 插件'));
    const s = await suggestLegacyCategories(db());
    expect(s.find(x => x.id === 'b1')?.suggested).toBeUndefined();
    expect(s.find(x => x.id === 'b2')?.suggested).toBe('小说/网络小说/仙侠修真');
  });

  it('parses AI items, resolving leaf names and dropping invalid ones', () => {
    const raw = '{"items":[{"index":0,"category":"心理学"},{"index":1,"category":"不存在"},{"index":5,"category":"其他"},{"index":2,"category":"其他"}]}';
    expect([...parseCategorizeResponse(raw, DEFAULT_CATEGORY_TREE, 3)]).toEqual([[0, '社科/心理学'], [2, '其他']]);
    expect(buildCategorizePrompt(DEFAULT_CATEGORY_TREE, [{ title: 'x' }])).toContain('小说/网络小说/玄幻');
  });

  it('keeps pre-tree single-level categories that collide with a tree path (e.g. 历史) pending until confirmed', () => {
    const d = db();
    d.prepare("INSERT INTO books (id, title, category) VALUES ('b6', '封神演义', '历史')").run();
    d.prepare("INSERT INTO settings (key, value) VALUES ('category_review_ids', '[\"b6\"]')").run();
    expect(listLegacyCategoryBooks(d).map(b => b.id)).toContain('b6');
    applyCategories(d, [{ book_id: 'b6', category: '历史' }]);   // 用户确认就是「历史」
    expect(listLegacyCategoryBooks(d).map(b => b.id)).not.toContain('b6');
  });

  it('applies confirmed categories, rejecting paths outside the tree', () => {
    const d = db();
    expect(applyCategories(d, [{ book_id: 'b1', category: '小说/中国古典小说' }])).toBe(1);
    expect((d.prepare("SELECT category FROM books WHERE id='b1'").get() as any).category).toBe('小说/中国古典小说');
    expect(() => applyCategories(d, [{ book_id: 'b2', category: '修真' }])).toThrow('不在分类表中');
  });
});
