process.env.JWT_SECRET = 'test-secret-for-token-version';

import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';

let _testDb: Database.Database | null = null;
jest.mock('../../src/db', () => ({
  getDb: () => {
    if (!_testDb) throw new Error('test DB not initialised');
    return _testDb;
  },
}));

import { authMiddleware, generateTokens, verifyRefreshToken } from '../../src/middleware/auth';

function makeDb() {
  const d = new Database(':memory:');
  d.exec("CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT, token_version INTEGER DEFAULT 0)");
  d.prepare("INSERT INTO users (id, role) VALUES ('u1', 'user')").run();
  return d;
}

function callAuth(token: string): number {
  let status = 200;
  const res = { status(code: number) { status = code; return this; }, json() { return this; }, setHeader() { return this; } };
  const req = { headers: { authorization: `Bearer ${token}` } };
  let nextCalled = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authMiddleware(req as any, res as any, () => { nextCalled = true; });
  return nextCalled ? 200 : status;
}

describe('token_version revocation', () => {
  beforeEach(() => { _testDb = makeDb(); });

  it('accepts tokens issued at the current version', () => {
    const { accessToken, refreshToken } = generateTokens('u1', 'user', 0);
    expect(callAuth(accessToken)).toBe(200);
    expect(verifyRefreshToken(refreshToken)).not.toBeNull();
  });

  it('rejects access and refresh tokens issued before a password change', () => {
    const { accessToken, refreshToken } = generateTokens('u1', 'user', 0);
    _testDb!.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = 'u1'").run();
    expect(callAuth(accessToken)).toBe(401);
    expect(verifyRefreshToken(refreshToken)).toBeNull();
  });

  it('treats legacy tokens without a version as version 0', () => {
    const legacy = jwt.sign({ userId: 'u1', role: 'user', type: 'access' }, process.env.JWT_SECRET!, { expiresIn: '2h' });
    expect(callAuth(legacy)).toBe(200);
  });
});
