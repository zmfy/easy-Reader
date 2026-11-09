import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'categories-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.header('x-test-role');
      if (!role) { res.status(401).json({ success: false, code: 'AUTH_UNAUTHORIZED' }); return; }
      (req as unknown as { user: unknown }).user = { userId: 'u1', role };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const libraryRoutes = require('../../src/routes/library').default;
const settingsRoutes = require('../../src/routes/settings').default;
const { getDb } = require('../../src/db');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRoutes);
  app.use('/api/settings', settingsRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const ins = getDb().prepare("INSERT INTO books (id, title, file_path, file_format, category, status) VALUES (?, ?, ?, 'txt', ?, 'normal')");
  [['1', '玄幻书', '小说/网络小说/玄幻'], ['2', '红楼梦', '小说/中国古典小说'], ['3', '心理学书', '社科/心理学'], ['4', '旧书', '言情']]
    .forEach(([id, title, cat]) => ins.run(id, title, `/books/${id}.txt`, cat));
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const call = (method: string, url: string, role = 'admin', body?: unknown) => fetch(base + url, {
  method,
  headers: { 'content-type': 'application/json', 'x-test-role': role },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const titles = async (q: string) => ((await (await call('GET', `/library?category=${encodeURIComponent(q)}`, 'user')).json()).data as Array<{ title: string }>).map(b => b.title).sort();

describe('category routes', () => {
  it('returns the tree with per-path counts to any logged-in user', async () => {
    const body = await (await call('GET', '/library/categories', 'user')).json();
    expect(body.data.tree[0].name).toBe('小说');
    expect(body.data.counts).toMatchObject({ '小说': 2, '小说/网络小说': 1, '社科': 1, '言情': 1 });
  });

  it('filters the library by category prefix', async () => {
    expect(await titles('小说')).toEqual(['玄幻书', '红楼梦'].sort());
    expect(await titles('小说/网络小说')).toEqual(['玄幻书']);
    expect(await titles('言情')).toEqual(['旧书']);
  });

  it('only accepts tree paths when editing a book category', async () => {
    expect((await call('PUT', '/library/4', 'admin', { category: '言情小说' })).status).toBe(422);
    // 编辑表单带回未改动的旧分类：放行
    expect((await call('PUT', '/library/4', 'admin', { title: '旧书', category: '言情' })).status).toBe(200);
    expect((await call('PUT', '/library/4', 'admin', { category: '小说/外国小说' })).status).toBe(200);
    expect((await call('PUT', '/library/4', 'admin', { category: '言情' })).status).toBe(422);
  });

  it('lists legacy categories and applies confirmed ones (admin only)', async () => {
    getDb().prepare("UPDATE books SET category = '武侠' WHERE id = '4'").run();
    expect((await call('GET', '/library/categories/legacy', 'user')).status).toBe(403);
    const legacy = (await (await call('GET', '/library/categories/legacy')).json()).data;
    expect(legacy.map((b: { id: string }) => b.id)).toEqual(['4']);
    expect((await call('POST', '/library/categories/legacy/apply', 'admin', { items: [{ book_id: '4', category: '武侠' }] })).status).toBe(422);
    expect((await call('POST', '/library/categories/legacy/apply', 'admin', { items: [{ book_id: '4', category: '小说/网络小说/武侠' }] })).status).toBe(200);
    expect((await (await call('GET', '/library/categories/legacy')).json()).data).toEqual([]);
  });

  it('saves an edited tree and renames book categories with it', async () => {
    const tree = (await (await call('GET', '/library/categories', 'user')).json()).data.tree;
    tree[0].children[0].name = '网文';
    expect((await call('PUT', '/settings/category-tree', 'user', { tree })).status).toBe(403);
    expect((await call('PUT', '/settings/category-tree', 'admin', { tree: [{ name: 'a/b' }] })).status).toBe(422);
    const res = await call('PUT', '/settings/category-tree', 'admin', { tree, renames: [{ from: '小说/网络小说', to: '小说/网文' }] });
    expect(res.status).toBe(200);
    expect((await res.json()).data.renamed).toBe(2);
    expect(await titles('小说/网文')).toEqual(['旧书', '玄幻书'].sort());
    // category_tree 不出现在通用设置里（设置页整体回存时会超长）
    expect((await (await call('GET', '/settings')).json()).data.category_tree).toBeUndefined();
  });
});
