import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-catalog-'));
process.env.DATA_DIR = DATA;

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const cat = require('../../src/services/opds-catalog');
/* eslint-enable @typescript-eslint/no-var-requires */

const db = getDb();
const ids = (p: { items: Array<{ id: string }> }) => p.items.map(b => b.id).sort();

function addBook(id: string, over: Record<string, unknown> = {}) {
  const row = { title: id, author: null, status: 'normal', category: null, series_id: null, imported_at: '2026-11-01 00:00:00', ...over };
  db.prepare(
    `INSERT INTO books (id, title, author, file_path, file_format, status, category, series_id, imported_at)
     VALUES (?, ?, ?, ?, 'txt', ?, ?, ?, ?)`
  ).run(id, row.title, row.author, `/b/${id}.txt`, row.status, row.category, row.series_id, row.imported_at);
}

beforeEach(() => {
  for (const t of ['books', 'shelf', 'reading_history', 'series']) db.prepare(`DELETE FROM ${t}`).run();
  addBook('ok', { title: '西游记', author: '吴承恩', category: '小说/中国古典小说', imported_at: '2026-11-03 00:00:00' });
  addBook('fixed', { title: '红楼梦', author: '曹雪芹', status: 'encoding_fixed', category: '小说/中国古典小说', imported_at: '2026-11-02 00:00:00' });
  addBook('dup', { title: '西游记2', author: '吴承恩', status: 'duplicate', category: '小说/中国古典小说' });
  addBook('garbled', { title: '乱码', status: 'garbled' });
  addBook('damaged', { title: '损坏', author: '吴承恩', status: 'damaged' });
  addBook('nullstatus', { title: '水浒传', author: '施耐庵', status: null, category: '小说/网络小说/玄幻', imported_at: '2026-11-04 00:00:00' });
});

describe('OPDS 目录查询', () => {
  it('所有列表只含可见的书（正常、编码已修正）', () => {
    const visible = ['fixed', 'nullstatus', 'ok'];
    expect(ids(cat.listAll(db, 1))).toEqual(visible);
    expect(ids(cat.listRecent(db, 1))).toEqual(visible);
    expect(ids(cat.listByAuthor(db, '吴承恩', 1))).toEqual(['ok']);
    expect(ids(cat.searchBooks(db, '吴承恩', 1))).toEqual(['ok']);
  });

  it('最新入库按入库时间倒序', () => {
    expect(cat.listRecent(db, 1).items.map((b: { id: string }) => b.id)).toEqual(['nullstatus', 'ok', 'fixed']);
  });

  it('分页：每页 50 本，第 2 页取剩下的', () => {
    for (let i = 0; i < 48; i++) addBook(`n${i}`);
    const p1 = cat.listAll(db, 1);
    const p2 = cat.listAll(db, 2);
    expect(cat.OPDS_PAGE_SIZE).toBe(50);
    expect(p1.items).toHaveLength(50);
    expect(p2.items).toHaveLength(1);
    expect(p2.total).toBe(51);
    expect(cat.listAll(db, 0).page).toBe(1);
  });

  it('书架和最近在读只含当前用户的', () => {
    db.prepare("INSERT INTO shelf (id, user_id, book_id) VALUES ('s1', 'u1', 'ok'), ('s2', 'u2', 'fixed'), ('s3', 'u1', 'damaged')").run();
    db.prepare("INSERT INTO reading_history (user_id, book_id) VALUES ('u1', 'fixed'), ('u2', 'ok')").run();
    expect(ids(cat.listShelf(db, 'u1', 1))).toEqual(['ok']);
    expect(ids(cat.listHistory(db, 'u1', 1))).toEqual(['fixed']);
  });

  it('搜索里的 % 和 _ 按字面匹配', () => {
    addBook('pct', { title: '百分之100%' });
    expect(ids(cat.searchBooks(db, '%', 1))).toEqual(['pct']);
    expect(ids(cat.searchBooks(db, '_', 1))).toEqual([]);
  });

  it('按分类列书包含下级，子分类带书数且不列空分类', () => {
    expect(ids(cat.listByCategory(db, '小说', 1))).toEqual(['fixed', 'nullstatus', 'ok']);
    const top = cat.categoryChildren(db, null);
    expect(top).toEqual([{ path: '小说', name: '小说', count: 3, hasChildren: true }]);
    const novel = cat.categoryChildren(db, '小说');
    expect(novel).toEqual([
      { path: '小说/网络小说', name: '网络小说', count: 1, hasChildren: true },
      { path: '小说/中国古典小说', name: '中国古典小说', count: 2, hasChildren: false },
    ]);
  });

  it('作者列表只含有可见书的作者并计数', () => {
    expect(cat.listAuthors(db, 1).items).toEqual([
      { author: '吴承恩', count: 1 }, { author: '施耐庵', count: 1 }, { author: '曹雪芹', count: 1 },
    ].sort((a, b) => (a.author < b.author ? -1 : 1)));
  });

  it('系列列表不含只有坏书的系列', () => {
    db.prepare("INSERT INTO series (id, name) VALUES ('sA', '甲系列'), ('sB', '乙系列')").run();
    db.prepare("UPDATE books SET series_id = 'sA' WHERE id IN ('ok', 'fixed')").run();
    db.prepare("UPDATE books SET series_id = 'sB' WHERE id = 'damaged'").run();
    expect(cat.listSeries(db, 1).items).toEqual([{ id: 'sA', name: '甲系列', count: 2 }]);
    expect(ids(cat.listSeriesBooks(db, 'sA', 1))).toEqual(['fixed', 'ok']);
    expect(cat.listSeriesBooks(db, 'sB', 1).items).toEqual([]);
  });

  it('书带显示书名', () => {
    expect(cat.listAll(db, 1).items[0]).toHaveProperty('display_title');
  });
});
