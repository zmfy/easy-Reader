import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = req.header('x-test-user');
      if (!user) { res.status(401).json({ success: false }); return; }
      (req as unknown as { user: unknown }).user = { userId: user, role: 'user' };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const historyRoutes = require('../../src/routes/history').default;
const { getDb } = require('../../src/db');
const { deleteBookRelations, deleteUserData } = require('../../src/services/relation-cleanup');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/history', historyRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/history`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const call = (method: string, url = '', user = 'u1') => fetch(base + url, {
  method, headers: { 'content-type': 'application/json', 'x-test-user': user },
});
const body = async (r: Response) => r.json();
const setOpened = (bookId: string, at: string, user = 'u1') =>
  getDb().prepare('UPDATE reading_history SET opened_at = ? WHERE user_id = ? AND book_id = ?').run(at, user, bookId);

beforeEach(() => {
  const db = getDb();
  for (const t of ['reading_history', 'reading_progress', 'books']) db.prepare(`DELETE FROM ${t}`).run();
  const ins = db.prepare("INSERT INTO books (id, title, author, file_path, file_format) VALUES (?, ?, ?, ?, ?)");
  ins.run('b1', '西游记', '吴承恩', '/b/1.txt', 'txt');
  ins.run('b2', '三国演义', '罗贯中', '/b/2.epub', 'epub');
  ins.run('b3', '红楼梦', '曹雪芹', '/b/3.pdf', 'pdf');
});

describe('阅读历史', () => {
  it('打开过的书按最近打开倒序列出，附上阅读进度', async () => {
    for (const b of ['b1', 'b2', 'b3']) expect((await call('POST', `/${b}`)).status).toBe(200);
    setOpened('b1', '2026-11-10 08:00:00');
    setOpened('b2', '2026-11-10 09:00:00');
    setOpened('b3', '2026-11-10 07:00:00');
    getDb().prepare("INSERT INTO reading_progress (id, user_id, book_id, chapter_index, chapter_title) VALUES ('p1', 'u1', 'b1', 4, '第五回')").run();

    const r = await body(await call('GET'));
    expect(r.data.map((i: { book_id: string }) => i.book_id)).toEqual(['b2', 'b1', 'b3']);
    expect(r.data[1]).toMatchObject({ title: '西游记', display_title: '西游记', chapter_index: 4, chapter_title: '第五回' });
    expect(r.data[0].chapter_index).toBeNull();
    expect(r.pagination).toMatchObject({ page: 1, pageSize: 30, total: 3 });
  });

  it('再次打开刷新时间排到最前，不重复', async () => {
    await call('POST', '/b1');
    await call('POST', '/b2');
    setOpened('b1', '2026-01-01 00:00:00');
    setOpened('b2', '2026-01-02 00:00:00');
    await call('POST', '/b1');
    const r = await body(await call('GET'));
    expect(r.data.map((i: { book_id: string }) => i.book_id)).toEqual(['b1', 'b2']);
  });

  it('分页', async () => {
    for (const b of ['b1', 'b2', 'b3']) await call('POST', `/${b}`);
    const r = await body(await call('GET', '?page=2&pageSize=2'));
    expect(r.data).toHaveLength(1);
    expect(r.pagination).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('不存在的书返回 404；只看到自己的历史', async () => {
    expect((await call('POST', '/nope')).status).toBe(404);
    await call('POST', '/b1', 'u2');
    expect((await body(await call('GET'))).data).toEqual([]);
    expect((await body(await call('GET', '', 'u2'))).data).toHaveLength(1);
  });

  it('移除和清空只影响历史，阅读进度保留', async () => {
    await call('POST', '/b1');
    await call('POST', '/b2');
    getDb().prepare("INSERT INTO reading_progress (id, user_id, book_id, chapter_index) VALUES ('p1', 'u1', 'b1', 2)").run();

    expect((await call('DELETE', '/b1')).status).toBe(200);
    expect((await call('DELETE', '/b1')).status).toBe(404);
    expect((await body(await call('GET'))).data.map((i: { book_id: string }) => i.book_id)).toEqual(['b2']);

    expect((await body(await call('DELETE'))).data).toEqual({ removed: 1 });
    expect((await body(await call('GET'))).data).toEqual([]);
    expect(getDb().prepare("SELECT chapter_index FROM reading_progress WHERE id = 'p1'").get()).toEqual({ chapter_index: 2 });
  });

  it('删书、删用户时一起清掉', async () => {
    await call('POST', '/b1');
    await call('POST', '/b2');
    await call('POST', '/b2', 'u2');
    const count = () => (getDb().prepare('SELECT COUNT(*) AS n FROM reading_history').get() as { n: number }).n;
    deleteBookRelations(getDb(), ['b1']);
    expect(count()).toBe(2);
    deleteUserData(getDb(), 'u1');
    expect(count()).toBe(1);
  });
});
