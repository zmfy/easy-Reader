import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'opds-cred-'));
process.env.DATA_DIR = DATA;

/* eslint-disable @typescript-eslint/no-var-requires */
const { getDb } = require('../../src/db');
const {
  OPDS_PASSWORD_ALPHABET, issueOpdsPassword, getOpdsStatus, disableOpds, verifyOpdsLogin,
} = require('../../src/services/opds-credentials');
const { deleteUserData } = require('../../src/services/relation-cleanup');
/* eslint-enable @typescript-eslint/no-var-requires */

const db = getDb();

beforeEach(() => {
  db.prepare('DELETE FROM opds_credentials').run();
  db.prepare("DELETE FROM users WHERE username != 'admin'").run();
  db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u1', 'alice', 'x', 'user')").run();
});

describe('OPDS 密码', () => {
  it('生成 16 位、只用无易混字符的字母表，库里只存哈希', () => {
    expect(OPDS_PASSWORD_ALPHABET).not.toMatch(/[0Oo1lI]/);
    const pw: string = issueOpdsPassword(db, 'u1');
    expect(pw).toHaveLength(16);
    for (const ch of pw) expect(OPDS_PASSWORD_ALPHABET).toContain(ch);
    const row = db.prepare('SELECT password_hash FROM opds_credentials WHERE user_id = ?').get('u1');
    expect(row.password_hash).not.toBe(pw);
    expect(bcrypt.compareSync(pw, row.password_hash)).toBe(true);
  });

  it('正确的用户名和密码通过，错密码 / 未知用户 / 未开通返回 null', () => {
    db.prepare("INSERT INTO users (id, username, password_hash, role) VALUES ('u2', 'bob', 'x', 'admin')").run();
    const pw = issueOpdsPassword(db, 'u1');
    expect(verifyOpdsLogin(db, 'alice', pw)).toEqual({ userId: 'u1', role: 'user' });
    expect(verifyOpdsLogin(db, 'alice', pw + 'x')).toBeNull();
    expect(verifyOpdsLogin(db, 'nobody', pw)).toBeNull();
    expect(verifyOpdsLogin(db, 'bob', pw)).toBeNull();
  });

  it('重置后旧密码失效、新密码可用', () => {
    const old = issueOpdsPassword(db, 'u1');
    const fresh = issueOpdsPassword(db, 'u1');
    expect(verifyOpdsLogin(db, 'alice', old)).toBeNull();
    expect(verifyOpdsLogin(db, 'alice', fresh)).not.toBeNull();
  });

  it('仍在使用默认密码的账号不能用 OPDS', () => {
    const pw = issueOpdsPassword(db, 'u1');
    db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?').run('u1');
    expect(verifyOpdsLogin(db, 'alice', pw)).toBeNull();
  });

  it('关闭后状态为未开通、密码失效；再次关闭返回 false', () => {
    const pw = issueOpdsPassword(db, 'u1');
    expect(getOpdsStatus(db, 'u1').enabled).toBe(true);
    expect(disableOpds(db, 'u1')).toBe(true);
    expect(getOpdsStatus(db, 'u1')).toEqual({ enabled: false, created_at: null, last_used_at: null });
    expect(verifyOpdsLogin(db, 'alice', pw)).toBeNull();
    expect(disableOpds(db, 'u1')).toBe(false);
  });

  it('校验成功会记录最近使用时间', () => {
    const pw = issueOpdsPassword(db, 'u1');
    expect(getOpdsStatus(db, 'u1').last_used_at).toBeNull();
    verifyOpdsLogin(db, 'alice', pw);
    expect(getOpdsStatus(db, 'u1').last_used_at).not.toBeNull();
  });

  it('删除用户数据时一并删除 OPDS 密码', () => {
    issueOpdsPassword(db, 'u1');
    deleteUserData(db, 'u1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM opds_credentials').get().n).toBe(0);
  });
});
