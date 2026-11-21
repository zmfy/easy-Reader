import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import bcrypt from 'bcryptjs';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-cred-route-'));
process.env.DATA_DIR = DATA;

jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  return {
    ...actual,
    authMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = req.header('x-test-user');
      if (!user) { res.status(401).json({ success: false }); return; }
      (req as unknown as { user: unknown }).user = { userId: user, role: req.header('x-test-role') || 'user', type: 'access' };
      next();
    },
  };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const opdsCredentialsRoutes = require('../../src/routes/opds-credentials').default;
const settingsRoutes = require('../../src/routes/settings').default;
const { getDb } = require('../../src/db');
const { verifyOpdsLogin } = require('../../src/services/opds-credentials');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/opds', opdsCredentialsRoutes);
  app.use('/api/settings', settingsRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const db = getDb();
const LOGIN_HASH = bcrypt.hashSync('Login-pass1', 4);
beforeEach(() => {
  for (const t of ['opds_credentials', 'audit_log']) db.prepare(`DELETE FROM ${t}`).run();
  db.prepare("DELETE FROM users WHERE id IN ('u1', 'a1')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'alice', ?, 'user')").run(LOGIN_HASH);
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('a1', 'boss', 'x', 'admin')").run();
});

const call = (method: string, url: string, user = 'u1', role = 'user', body?: unknown) => fetch(base + url, {
  method,
  headers: { 'content-type': 'application/json', 'x-test-user': user, 'x-test-role': role },
  body: method === 'POST' ? JSON.stringify(body ?? { currentPassword: 'Login-pass1' }) : undefined,
});
const auditActions = () => db.prepare('SELECT action, resource_id FROM audit_log ORDER BY rowid').all();

describe('OPDS 密码自助接口', () => {
  it('开通返回一次性密码，之后查询状态不再返回密码', async () => {
    const before = await (await call('GET', '/opds/credentials')).json();
    expect(before.data).toEqual({ enabled: false, created_at: null, last_used_at: null, username: 'alice' });

    const r = await call('POST', '/opds/credentials');
    expect(r.status).toBe(201);
    const { data } = await r.json();
    expect(data.username).toBe('alice');
    expect(data.password).toHaveLength(16);
    expect(verifyOpdsLogin(db, 'alice', data.password)).not.toBeNull();

    const after = (await (await call('GET', '/opds/credentials')).json()).data;
    expect(after.enabled).toBe(true);
    expect(after).not.toHaveProperty('password');
  });

  it('开通或重置必须输入正确的登录密码', async () => {
    expect((await call('POST', '/opds/credentials', 'u1', 'user', {})).status).toBe(422);
    expect((await call('POST', '/opds/credentials', 'u1', 'user', { currentPassword: 'wrong' })).status).toBe(422);
    expect((await (await call('GET', '/opds/credentials')).json()).data.enabled).toBe(false);
  });

  it('第一次记为开通，再次调用记为重置', async () => {
    await call('POST', '/opds/credentials');
    await call('POST', '/opds/credentials');
    expect(auditActions().map((a: { action: string }) => a.action)).toEqual(['opds_enable', 'opds_reset']);
  });

  it('关闭后再关闭返回 404', async () => {
    await call('POST', '/opds/credentials');
    expect((await call('DELETE', '/opds/credentials')).status).toBe(200);
    expect((await call('DELETE', '/opds/credentials')).status).toBe(404);
    expect(auditActions().map((a: { action: string }) => a.action)).toEqual(['opds_enable', 'opds_disable']);
  });
});

describe('管理员管理 OPDS', () => {
  it('用户列表带开通状态', async () => {
    await call('POST', '/opds/credentials');
    const list = (await (await call('GET', '/settings/users', 'a1', 'admin')).json()).data;
    const alice = list.find((u: { id: string }) => u.id === 'u1');
    const boss = list.find((u: { id: string }) => u.id === 'a1');
    expect(alice.opds_enabled).toBe(true);
    expect(alice.opds_created_at).toBeTruthy();
    expect(boss).toMatchObject({ opds_enabled: false, opds_created_at: null });
  });

  it('管理员可以关闭用户的 OPDS，并记审计日志', async () => {
    await call('POST', '/opds/credentials');
    expect((await call('DELETE', '/settings/users/u1/opds', 'a1', 'admin')).status).toBe(200);
    const status = (await (await call('GET', '/opds/credentials')).json()).data;
    expect(status.enabled).toBe(false);
    expect(auditActions().at(-1)).toEqual({ action: 'opds_disable', resource_id: 'u1' });
    expect((await call('DELETE', '/settings/users/u1/opds', 'a1', 'admin')).status).toBe(404);
  });

  it('普通用户不能调用管理员接口', async () => {
    await call('POST', '/opds/credentials');
    expect((await call('DELETE', '/settings/users/u1/opds', 'u1', 'user')).status).toBe(403);
  });
});
