import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

// 数据目录指向临时目录（路由模块加载时读取 DATA_DIR）
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-https-'));
process.env.DATA_DIR = DATA;

// 只替换登录校验：按请求头注入用户；管理员检查用真实实现
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const settingsRoutes = require('../../src/routes/settings').default;

const FIX = path.join(__dirname, '../fixtures/certs');
const read = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const CERT = read('cert.pem');
const KEY = read('key.pem');
const OTHER_KEY = read('other-key.pem');

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api/settings', settingsRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/settings/https`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const call = (method: string, role?: string, body?: unknown) => fetch(base, {
  method,
  headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('/api/settings/https', () => {
  it('is admin-only for every method', async () => {
    for (const m of ['GET', 'PUT', 'DELETE']) {
      expect((await call(m)).status).toBe(401);
      expect((await call(m, 'user', m === 'PUT' ? { cert: CERT, key: KEY } : undefined)).status).toBe(403);
    }
    expect(fs.existsSync(path.join(DATA, 'certs', 'privkey.pem'))).toBe(false);
  });

  it('rejects a mismatched pair with the exact message and keeps files untouched', async () => {
    const r = await call('PUT', 'admin', { cert: CERT, key: OTHER_KEY });
    expect(r.status).toBe(422);
    expect((await r.json()).message).toBe('证书与私钥不匹配');
    expect(fs.existsSync(path.join(DATA, 'certs', 'fullchain.pem'))).toBe(false);
  });

  it('saves a valid pair without echoing the private key, then deletes it', async () => {
    const r = await call('PUT', 'admin', { cert: CERT, key: KEY });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('PRIVATE KEY');
    expect(JSON.parse(text).data.warnings).toEqual([]);
    expect(fs.readFileSync(path.join(DATA, 'certs', 'privkey.pem'), 'utf8').trim()).toBe(KEY.trim());
    const g = await call('GET', 'admin');
    expect(await g.text()).not.toContain('PRIVATE KEY');
    expect((await call('DELETE', 'admin')).status).toBe(200);
    expect(fs.existsSync(path.join(DATA, 'certs', 'privkey.pem'))).toBe(false);
  });

  it('answers 500 instead of crashing when the certificate directory cannot be written', async () => {
    fs.rmSync(path.join(DATA, 'certs'), { recursive: true, force: true });
    fs.writeFileSync(path.join(DATA, 'certs'), 'not a directory');
    try {
      const r = await call('PUT', 'admin', { cert: CERT, key: KEY });
      expect(r.status).toBe(500);
      expect((await r.json()).message).toContain('证书保存失败');
    } finally {
      fs.rmSync(path.join(DATA, 'certs'), { force: true });
    }
  });

  it('toggles the HTTPS switch (admin only) and reports it in the status', async () => {
    const put = (role: string | undefined, body: unknown) => fetch(`${base}/enabled`, {
      method: 'PUT', headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify(body),
    });
    expect((await put('user', { enabled: true })).status).toBe(403);
    expect((await put('admin', { enabled: 'yes' })).status).toBe(422);
    const on = await put('admin', { enabled: true });
    expect(on.status).toBe(200);
    expect((await on.json()).data.enabled).toBe(true);
    expect((await (await call('GET', 'admin')).json()).data.enabled).toBe(true);
    const off = await put('admin', { enabled: false });
    expect((await off.json()).data.enabled).toBe(false);
  });

  it('answers 500 instead of crashing when the switch cannot be saved', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../src/services/https-server');
    const spy = jest.spyOn(mod, 'setHttpsEnabled').mockImplementation(() => { throw Object.assign(new Error('readonly'), { code: 'SQLITE_READONLY' }); });
    try {
      const r = await fetch(`${base}/enabled`, {
        method: 'PUT', headers: { 'content-type': 'application/json', 'x-test-role': 'admin' }, body: JSON.stringify({ enabled: true }),
      });
      expect(r.status).toBe(500);
      expect((await r.json()).message).toContain('切换失败');
    } finally {
      spy.mockRestore();
    }
  });
});
