import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { strongPasswordSchema, markDefaultPasswordUsers, DEFAULT_ADMIN_PASSWORD } from '../../src/utils/password-policy';

describe('strongPasswordSchema', () => {
  it.each(['Abcdef1!', 'Xy9#xxxxxxxx'])('accepts %p', (p) => {
    expect(strongPasswordSchema.safeParse(p).success).toBe(true);
  });

  it.each([
    ['Ab1!', '至少8位'],
    ['abcdefg1!', '大写'],
    ['ABCDEFG1!', '小写'],
    ['Abcdefgh!', '数字'],
    ['Abcdefgh1', '特殊字符'],
    [DEFAULT_ADMIN_PASSWORD, ''],
  ])('rejects %p', (p, msg) => {
    const r = strongPasswordSchema.safeParse(p);
    expect(r.success).toBe(false);
    if (msg) expect(r.error!.issues.map(i => i.message).join()).toContain(msg);
  });
});

describe('markDefaultPasswordUsers', () => {
  it('flags only accounts whose password is still the default', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE users (id TEXT PRIMARY KEY, password_hash TEXT, must_change_password INTEGER DEFAULT 0)');
    const ins = db.prepare('INSERT INTO users (id, password_hash) VALUES (?, ?)');
    ins.run('a', bcrypt.hashSync(DEFAULT_ADMIN_PASSWORD, 4));
    ins.run('b', bcrypt.hashSync('Other#Pass1', 4));
    expect(markDefaultPasswordUsers(db)).toBe(1);
    const rows = db.prepare('SELECT id, must_change_password AS m FROM users ORDER BY id').all();
    expect(rows).toEqual([{ id: 'a', m: 1 }, { id: 'b', m: 0 }]);
  });
});
