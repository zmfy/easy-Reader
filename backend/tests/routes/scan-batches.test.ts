import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-batches-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { user: unknown }).user = { userId: 'admin1', role: 'admin' };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const scanBatchRoutes = require('../../src/routes/scan-batches').default;
const { getDb } = require('../../src/db');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/scan-batches', scanBatchRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/scan-batches`;
});
afterAll(async () => {
  await new Promise<void>(r => server.close(() => r()));
  fs.rmSync(DATA, { recursive: true, force: true });
});

const call = (method: string, url: string, body?: unknown) => fetch(base + url, {
  method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

beforeEach(() => {
  const db = getDb();
  for (const t of ['scan_batch_items', 'scan_batches', 'books', 'scan_skipped_files']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("INSERT INTO scan_batches (id, task_id, status) VALUES ('B1', 't', 'pending')").run();
  db.prepare("INSERT INTO scan_batch_items (id, batch_id, type, payload) VALUES ('I1', 'B1', 'damaged', ?)")
    .run(JSON.stringify({ file_path: '/books/坏书.epub', file_size: 10, file_mtime: 5.5, reason: '解析超时' }));
});

describe('应用含损坏 EPUB 的批次', () => {
  it('损坏项未决定 → 422，批次仍是 pending', async () => {
    const r = await call('POST', '/B1/apply');
    expect(r.status).toBe(422);
    const body = await r.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('请先为每本损坏的书选择导入或跳过');
    expect(getDb().prepare("SELECT status FROM scan_batches WHERE id = 'B1'").get()).toEqual({ status: 'pending' });
  });

  it('选择跳过后可以应用，写跳过记录', async () => {
    expect((await call('PATCH', '/B1/items/I1', { decision: 'reject' })).status).toBe(200);
    const r = await call('POST', '/B1/apply');
    expect(r.status).toBe(200);
    expect((await r.json()).data.damaged_skipped).toBe(1);
    expect(getDb().prepare('SELECT file_path FROM scan_skipped_files').all()).toEqual([{ file_path: '/books/坏书.epub' }]);
  });
});
