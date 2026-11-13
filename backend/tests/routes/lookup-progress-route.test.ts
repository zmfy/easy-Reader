import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'lookup-progress-'));
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
const { startLookupProgress, setLookupProgress } = require('../../src/services/lookup-progress');
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

const get = (url: string, role = 'admin') => fetch(base + url, { headers: { 'x-test-role': role } });

describe('GET /api/library/:id/ai-fill/progress', () => {
  it('is admin-only', async () => {
    expect((await get('/b1/ai-fill/progress', 'user')).status).toBe(403);
  });

  it('returns empty progress when nothing is recorded', async () => {
    const r = await get('/none/ai-fill/progress');
    expect(r.status).toBe(200);
    expect((await r.json()).data).toEqual({ steps: [], done: false });
  });

  it('returns the recorded lookup steps', async () => {
    startLookupProgress('b1');
    setLookupProgress('b1', [{ kind: 'search_book', query: '魔戒', count: 3 }]);
    const r = await get('/b1/ai-fill/progress');
    expect((await r.json()).data).toEqual({ steps: [{ kind: 'search_book', query: '魔戒', count: 3 }], done: false });
  });
});
