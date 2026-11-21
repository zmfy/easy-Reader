import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import bcrypt from 'bcryptjs';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-admin-'));
process.env.DATA_DIR = DATA;

// 认证：x-test-user 指定当前用户，x-test-role 指定角色
jest.mock('../../src/middleware/auth', () => {
  const actual = jest.requireActual('../../src/middleware/auth');
  const fake = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const user = req.header('x-test-user');
    if (!user) { res.status(401).json({ success: false }); return; }
    (req as unknown as { user: unknown }).user = { userId: user, role: req.header('x-test-role') || 'user', type: 'access' };
    next();
  };
  return { ...actual, authMiddleware: fake, authAllowingPasswordChange: fake };
});

/* eslint-disable @typescript-eslint/no-var-requires */
const settingsRoutes = require('../../src/routes/settings').default;
const authRoutes = require('../../src/routes/auth').default;
const { getDb } = require('../../src/db');
const { issueOpdsPassword, getOpdsStatus } = require('../../src/services/opds-credentials');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRoutes);
  app.use('/api/auth', authRoutes);
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const db = getDb();
beforeEach(() => {
  db.prepare('DELETE FROM opds_credentials').run();
  db.prepare("DELETE FROM users WHERE id IN ('u1', 'a1')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'alice', ?, 'user')").run(bcrypt.hashSync('Old-pass1', 4));
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('a1', 'boss', 'x', 'admin')").run();
  issueOpdsPassword(db, 'u1');
});

const send = (method: string, url: string, user: string, role: string, body?: unknown) => fetch(base + url, {
  method,
  headers: { 'content-type': 'application/json', 'x-test-user': user, 'x-test-role': role },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('账户变动对 OPDS 密码的影响', () => {
  it('管理员重置该用户登录密码后 OPDS 作废', async () => {
    const r = await send('PUT', '/settings/users/u1/password', 'a1', 'admin', { password: 'New-pass1!' });
    expect(r.status).toBe(200);
    expect(getOpdsStatus(db, 'u1').enabled).toBe(false);
  });

  it('用户自己修改登录密码不影响 OPDS', async () => {
    const r = await send('POST', '/auth/password', 'u1', 'user', { currentPassword: 'Old-pass1', newPassword: 'New-pass1!' });
    expect(r.status).toBe(200);
    expect(getOpdsStatus(db, 'u1').enabled).toBe(true);
  });

  it('管理员改角色不影响 OPDS', async () => {
    const r = await send('PUT', '/settings/users/u1/role', 'a1', 'admin', { role: 'admin' });
    expect(r.status).toBe(200);
    expect(getOpdsStatus(db, 'u1').enabled).toBe(true);
  });
});
