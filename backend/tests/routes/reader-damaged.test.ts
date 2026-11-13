import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-damaged-'));
const BOOKS = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-damaged-books-'));
process.env.DATA_DIR = DATA;
process.env.BOOKS_DIR = BOOKS;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { userId: 'u1', role: 'admin' };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const readerRoutes = require('../../src/routes/reader').default;
const libraryRoutes = require('../../src/routes/library').default;
const { getDb } = require('../../src/db');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/reader', readerRoutes);
  app.use('/api/library', libraryRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM books').run();
  const ins = db.prepare("INSERT INTO books (id, title, file_path, file_format, status, damage_reason) VALUES (?, ?, ?, ?, ?, ?)");
  fs.writeFileSync(path.join(BOOKS, 'cut.epub'), Buffer.from('PK\x03\x04 truncated'));
  fs.writeFileSync(path.join(BOOKS, 'junk.epub'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), Buffer.from('x'), Buffer.from([0x50, 0x4b, 0x05, 0x06])]));
  ins.run('d1', '坏书', path.join(BOOKS, 'cut.epub'), 'epub', 'damaged', '缺少书籍目录（content.opf）');
  ins.run('d2', '坏书无原因', path.join(BOOKS, 'cut.epub'), 'epub', 'damaged', null);
  ins.run('n1', '截断但状态正常', path.join(BOOKS, 'cut.epub'), 'epub', 'normal', null);
  ins.run('n2', '无法分类', path.join(BOOKS, 'junk.epub'), 'epub', 'normal', null);
  ins.run('n3', '同样截断的 pdf', path.join(BOOKS, 'cut.epub'), 'pdf', 'normal', null);
  ins.run('g1', '乱码', '/b/g.txt', 'txt', 'garbled', null);
});

describe('损坏书的阅读提示', () => {
  it('damaged 书请求章节 → 409 带原因', async () => {
    const res = await fetch(`${base}/reader/d1/chapters`);
    const j = await res.json();
    expect(res.status).toBe(409);
    expect(j.code).toBe('BUSINESS_CONFLICT');
    expect(j.message).toBe('文件不完整或已损坏：缺少书籍目录（content.opf）。请重新获取文件后重新扫描');
    expect((await fetch(`${base}/reader/d1/chapter/0`)).status).toBe(409);
  });

  it('damaged 书没有原因 → 用「无法解析」兜底', async () => {
    const j = await (await fetch(`${base}/reader/d2/chapters`)).json();
    expect(j.message).toBe('文件不完整或已损坏：无法解析。请重新获取文件后重新扫描');
  });

  it('状态正常的 EPUB 解析失败且文件被截断 → 同样的 409', async () => {
    const res = await fetch(`${base}/reader/n1/chapters`);
    expect(res.status).toBe(409);
    expect((await res.json()).message).toBe('文件不完整或已损坏：文件不完整（可能下载或复制中断）。请重新获取文件后重新扫描');
  });

  it('分类不出原因 → 保持「无法读取章节」', async () => {
    const res = await fetch(`${base}/reader/n2/chapters`);
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe('无法读取章节');
  });

  it('非 EPUB 不做分类', async () => {
    expect((await fetch(`${base}/reader/n3/chapters`)).status).toBe(500);
  });
});

describe('书库筛选', () => {
  const ids = async (q: string) => ((await (await fetch(`${base}/library?${q}`)).json()).data as Array<{ id: string }>).map(b => b.id).sort();
  it('problems 含 damaged，status=damaged 只返回 damaged', async () => {
    expect(await ids('status=problems')).toEqual(['d1', 'd2', 'g1']);
    expect(await ids('status=damaged')).toEqual(['d1', 'd2']);
  });
  it('默认书库不含 damaged', async () => {
    const list = await ids('pageSize=50');
    expect(list).not.toContain('d1');
  });
});
