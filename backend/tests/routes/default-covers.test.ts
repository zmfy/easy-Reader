import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'default-covers-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const role = req.header('x-test-role');
      if (!role) { res.status(401).json({ success: false }); return; }
      (req as unknown as { user: unknown }).user = { userId: 'u1', role };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const libraryRoutes = require('../../src/routes/library').default;
const { getDb } = require('../../src/db');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/library', libraryRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/library`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const call = (method: string, url: string, role = 'admin') =>
  fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-role': role }, body: method === 'POST' ? '{}' : undefined });

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM books').run();
  const ins = db.prepare("INSERT INTO books (id, title, author, category, cover_url, file_path, file_format, status, duplicate_of) VALUES (?, ?, ?, ?, ?, ?, 'txt', ?, ?)");
  ins.run('b1', '克莱因文集(经典套装全4册)', '克莱因', null, null, '/b/1.txt', 'normal', null);
  ins.run('b2', '西游记', '吴承恩', null, '/covers/b2.jpg', '/b/2.txt', 'normal', null);  // 已有封面：不动
  ins.run('b3', '南怀瑾著作全收录', null, null, '', '/b/3.txt', 'normal', null);
  ins.run('b4', '克莱因文集', null, null, null, '/b/4.txt', 'normal', 'b1');               // 重复书：不处理
});

describe('给没有封面的书生成默认封面', () => {
  it('ai-fill-status 返回没有封面的书数', async () => {
    const r = await (await call('GET', '/ai-fill-status')).json();
    expect(r.data.no_cover).toBe(2);
  });

  it('只处理正常、非重复、没有封面的书，生成 svg 文件', async () => {
    expect((await call('POST', '/default-covers', 'user')).status).toBe(403);
    const r = await (await call('POST', '/default-covers')).json();
    expect(r.data).toEqual({ generated: 2 });
    const rows = getDb().prepare('SELECT id, cover_url FROM books ORDER BY id').all() as Array<{ id: string; cover_url: string | null }>;
    const byId = Object.fromEntries(rows.map(x => [x.id, x.cover_url]));
    expect(byId.b1).toMatch(/^\/covers\/b1-.+\.svg$/);
    expect(byId.b2).toBe('/covers/b2.jpg');
    expect(byId.b3).toMatch(/^\/covers\/b3-.+\.svg$/);
    expect(byId.b4).toBeNull();
    const svg = fs.readFileSync(path.join(DATA, 'covers', path.basename(byId.b1!)), 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('克');  // 印着书名（清洗后的「克莱因文集」，竖排逐字）
    // 再点一次：都有封面了
    expect((await (await call('POST', '/default-covers')).json()).data).toEqual({ generated: 0 });
    expect((await (await call('GET', '/ai-fill-status')).json()).data.no_cover).toBe(0);
  });
});
