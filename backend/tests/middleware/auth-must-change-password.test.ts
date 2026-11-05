process.env.JWT_SECRET = 'test-secret-for-must-change';

import Database from 'better-sqlite3';

let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({
  getDb: () => {
    if (!_testDb) throw new Error('test DB not initialised');
    return _testDb;
  },
}));

import { authMiddleware, authAllowingPasswordChange, generateTokens } from '../../src/middleware/auth';

function makeDb(mustChange: number) {
  const d = new Database(':memory:');
  d.exec('CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, token_version INTEGER DEFAULT 0, must_change_password INTEGER DEFAULT 0)');
  d.prepare("INSERT INTO users (id, role, must_change_password) VALUES ('u1', 'admin', ?)").run(mustChange);
  return d;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function call(mw: any, token: string): { status: number; code?: string } {
  let status = 200;
  let code: string | undefined;
  const res = {
    status(c: number) { status = c; return this; },
    json(body: { code?: string }) { code = body.code; return this; },
    setHeader() { return this; },
  };
  let nextCalled = false;
  mw({ headers: { authorization: `Bearer ${token}` } }, res, () => { nextCalled = true; });
  return nextCalled ? { status: 200 } : { status, code };
}

describe('must_change_password', () => {
  it('blocks normal endpoints until the password is changed', () => {
    _testDb = makeDb(1);
    const { accessToken } = generateTokens('u1', 'admin', 0);
    expect(call(authMiddleware, accessToken)).toEqual({ status: 403, code: 'AUTH_PASSWORD_CHANGE_REQUIRED' });
  });

  it('still allows the endpoints needed to change the password', () => {
    _testDb = makeDb(1);
    const { accessToken } = generateTokens('u1', 'admin', 0);
    expect(call(authAllowingPasswordChange, accessToken)).toEqual({ status: 200 });
  });

  it('lets users without the flag through both middlewares', () => {
    _testDb = makeDb(0);
    const { accessToken } = generateTokens('u1', 'admin', 0);
    expect(call(authMiddleware, accessToken)).toEqual({ status: 200 });
    expect(call(authAllowingPasswordChange, accessToken)).toEqual({ status: 200 });
  });

  it('applies immediately to sessions that already exist (flag read from the database)', () => {
    _testDb = makeDb(0);
    const { accessToken } = generateTokens('u1', 'admin', 0);
    _testDb.prepare("UPDATE users SET must_change_password = 1 WHERE id = 'u1'").run();
    expect(call(authMiddleware, accessToken).status).toBe(403);
  });

  it('still rejects invalid tokens with 401 in the relaxed middleware', () => {
    _testDb = makeDb(1);
    expect(call(authAllowingPasswordChange, 'bogus').status).toBe(401);
  });
});
