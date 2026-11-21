import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-auth-'));
process.env.DATA_DIR = DATA;

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const { issueOpdsPassword } = require('../../src/services/opds-credentials');
const { opdsAuth } = require('../../src/middleware/opds-auth');
/* eslint-enable @typescript-eslint/no-var-requires */

let server: Server;
let url: string;
const db = getDb();
let alicePw = '';
let zhangPw = '';

beforeAll(async () => {
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'alice', 'x', 'user')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u2', '张三', 'x', 'admin')").run();
  alicePw = issueOpdsPassword(db, 'u1');
  zhangPw = issueOpdsPassword(db, 'u2');
  const app = express();
  app.set('trust proxy', 'loopback');
  app.get('/opds', ...opdsAuth, (req, res) => { res.json(req.user); });
  // 模拟慢下载：认证通过后迟迟不响应，客户端中途断开
  app.get('/opds/slow', ...opdsAuth, () => { /* never responds */ });
  await new Promise<void>(r => { server = app.listen(0, () => r()); });
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/opds`;
});
afterAll(async () => { await new Promise<void>(r => server.close(() => r())); });

const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`, 'utf8').toString('base64');
const get = (authorization?: string, ip = '10.0.0.1') =>
  fetch(url, { headers: { ...(authorization ? { authorization } : {}), 'x-forwarded-for': ip } });

describe('OPDS Basic 认证', () => {
  it('没有认证头时返回 401 并要求 Basic 认证', async () => {
    const r = await get();
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toBe('Basic realm="easyReader"');
  });

  it('密码错误或用 Bearer 令牌都返回 401', async () => {
    for (const h of [basic('alice', 'wrong'), 'Bearer abc']) {
      const r = await get(h);
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Basic realm="easyReader"');
    }
  });

  it('用户名和 OPDS 密码正确时通过，带上当前用户', async () => {
    const r = await get(basic('alice', alicePw));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ userId: 'u1', role: 'user' });
  });

  it('中文用户名按 UTF-8 解码', async () => {
    const r = await get(basic('张三', zhangPw));
    expect(r.status).toBe(200);
    expect((await r.json()).userId).toBe('u2');
  });

  it('不带认证头的请求（客户端先探测）不计入失败次数', async () => {
    for (let i = 0; i < 25; i++) expect((await get(undefined, '10.0.0.2')).status).toBe(401);
    expect((await get(basic('alice', alicePw), '10.0.0.2')).status).toBe(200);
  });

  it('认证通过但中途断开的请求（如下载被取消）不计入失败次数', async () => {
    for (let i = 0; i < 25; i++) {
      const ctl = new AbortController();
      const p = fetch(url + '/slow', { headers: { authorization: basic('alice', alicePw), 'x-forwarded-for': '10.0.0.4' }, signal: ctl.signal }).catch(() => undefined);
      await new Promise(r => setTimeout(r, 30));
      ctl.abort();
      await p;
    }
    await new Promise(r => setTimeout(r, 50));
    expect((await get(basic('alice', alicePw), '10.0.0.4')).status).toBe(200);
  });

  it('同一 IP 密码连续错 20 次后被限流', async () => {
    for (let i = 0; i < 20; i++) expect((await get(basic('alice', 'bad'), '10.0.0.3')).status).toBe(401);
    expect((await get(basic('alice', alicePw), '10.0.0.3')).status).toBe(429);
  });
});
