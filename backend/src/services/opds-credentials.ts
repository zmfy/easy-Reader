import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

// OPDS 专用密码：阅读 App 用 HTTP Basic 登录，密码明文存在设备上，所以不用登录密码。
// 墨水屏上可能要手输，去掉易混字符 0 O o 1 l I
export const OPDS_PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PASSWORD_LENGTH = 16;
// 最近使用时间只在距上次超过 10 分钟时写，避免阅读 App 的每个请求都写库
const LAST_USED_THROTTLE_MS = 10 * 60 * 1000;

export interface OpdsStatus {
  enabled: boolean;
  created_at: string | null;
  last_used_at: string | null;
}

/** 开通或重置：生成新密码（旧的立即失效），返回明文，只在此时可见 */
export function issueOpdsPassword(db: Database.Database, userId: string): string {
  let password = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) password += OPDS_PASSWORD_ALPHABET[randomInt(OPDS_PASSWORD_ALPHABET.length)];
  db.prepare(
    `INSERT INTO opds_credentials (user_id, password_hash, created_at, last_used_at) VALUES (?, ?, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, created_at = CURRENT_TIMESTAMP, last_used_at = NULL`
  ).run(userId, bcrypt.hashSync(password, 10));
  return password;
}

export function getOpdsStatus(db: Database.Database, userId: string): OpdsStatus {
  const row = db.prepare('SELECT created_at, last_used_at FROM opds_credentials WHERE user_id = ?').get(userId) as
    { created_at: string; last_used_at: string | null } | undefined;
  if (!row) return { enabled: false, created_at: null, last_used_at: null };
  return { enabled: true, created_at: row.created_at, last_used_at: row.last_used_at };
}

export function disableOpds(db: Database.Database, userId: string): boolean {
  return db.prepare('DELETE FROM opds_credentials WHERE user_id = ?').run(userId).changes > 0;
}

/** 校验 OPDS 登录；用户不存在、未开通、密码错、仍在用默认密码时返回 null */
export function verifyOpdsLogin(
  db: Database.Database, username: string, password: string,
): { userId: string; role: 'admin' | 'user' } | null {
  const row = db.prepare(
    `SELECT u.id, u.role, u.must_change_password, c.password_hash, c.last_used_at
       FROM users u JOIN opds_credentials c ON c.user_id = u.id WHERE u.username = ?`
  ).get(username) as
    { id: string; role: 'admin' | 'user'; must_change_password: number | null; password_hash: string; last_used_at: string | null } | undefined;
  if (!row || row.must_change_password) return null;
  if (!bcrypt.compareSync(password, row.password_hash)) return null;

  const last = row.last_used_at ? Date.parse(row.last_used_at.replace(' ', 'T') + 'Z') : 0;
  if (!last || Date.now() - last > LAST_USED_THROTTLE_MS) {
    db.prepare('UPDATE opds_credentials SET last_used_at = CURRENT_TIMESTAMP WHERE user_id = ?').run(row.id);
  }
  return { userId: row.id, role: row.role };
}
