import { z } from 'zod';
import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';

/** 首次启动自动创建的管理员密码；仍在使用它的账号必须先改密码 */
export const DEFAULT_ADMIN_PASSWORD = 'admin123';

/** 管理员重置密码、用户自己改密码共用的规则 */
export const strongPasswordSchema = z.string()
  .max(100, '密码最长 100 位')
  .min(8, '密码至少8位')
  .regex(/[A-Z]/, '密码必须包含至少一个大写字母')
  .regex(/[a-z]/, '密码必须包含至少一个小写字母')
  .regex(/[0-9]/, '密码必须包含至少一个数字')
  .regex(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?`~]/, '密码必须包含至少一个特殊字符');

/** 把密码仍是默认密码的账号标记为必须改密码（升级时一次性执行，账号很少，逐个比对即可） */
export function markDefaultPasswordUsers(db: Database.Database): number {
  const users = db.prepare('SELECT id, password_hash FROM users').all() as Array<{ id: string; password_hash: string }>;
  const mark = db.prepare('UPDATE users SET must_change_password = 1 WHERE id = ?');
  let count = 0;
  for (const u of users) {
    if (u.password_hash && bcrypt.compareSync(DEFAULT_ADMIN_PASSWORD, u.password_hash)) {
      mark.run(u.id);
      count++;
    }
  }
  return count;
}
