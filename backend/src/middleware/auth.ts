import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { errorResponse } from '../utils/response';
import { JwtPayload } from '../types';
import { JWT_SECRET } from '../secret';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next, false);
}

/**
 * 与 authMiddleware 相同，但仍在使用默认密码的账号也放行。
 * 只用于改密码所需的接口：/auth/me、/auth/password、/auth/logout
 */
export function authAllowingPasswordChange(req: Request, res: Response, next: NextFunction): void {
  authenticate(req, res, next, true);
}

function authenticate(req: Request, res: Response, next: NextFunction, allowPendingPasswordChange: boolean): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '未提供认证令牌');
    return;
  }

  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '令牌无效或已过期');
    return;
  }

  // refresh token 不能当作 access token 使用
  if (payload.type !== 'access') {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '令牌无效或已过期');
    return;
  }

  // 以数据库为准：用户被删除、角色变更或密码修改后立即生效
  const user = findTokenUser(payload);
  if (!user) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '令牌无效或已失效');
    return;
  }

  // 默认密码未修改：除改密码相关接口外一律拒绝（标记从数据库读，已登录的会话也立即生效）
  if (user.must_change_password && !allowPendingPasswordChange) {
    errorResponse(res, 403, 'AUTH_PASSWORD_CHANGE_REQUIRED', '请先修改默认密码');
    return;
  }

  req.user = { userId: user.id, role: user.role, type: 'access' };
  next();
}

interface TokenUser {
  id: string;
  role: 'admin' | 'user';
  token_version: number;
  must_change_password: boolean;
}

/** The user a token belongs to, or null if the user is gone or the token was revoked (version bumped). */
function findTokenUser(payload: JwtPayload): TokenUser | null {
  const user = getDb().prepare('SELECT id, role, token_version, must_change_password FROM users WHERE id = ?').get(payload.userId) as
    { id: string; role: 'admin' | 'user'; token_version: number | null; must_change_password: number | null } | undefined;
  if (!user) return null;
  const currentVersion = user.token_version ?? 0;
  // Tokens issued before versioning carry no tv: treat as version 0
  if ((payload.tv ?? 0) !== currentVersion) return null;
  return { id: user.id, role: user.role, token_version: currentVersion, must_change_password: !!user.must_change_password };
}

/** Verify a refresh token against current DB state; returns the user to re-issue tokens for, or null. */
export function verifyRefreshToken(token: string): TokenUser | null {
  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
  if (payload.type !== 'refresh') return null;
  return findTokenUser(payload);
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    errorResponse(res, 403, 'AUTH_FORBIDDEN', '需要管理员权限');
    return;
  }
  next();
}

export function generateTokens(userId: string, role: 'admin' | 'user', tokenVersion = 0): { accessToken: string; refreshToken: string } {
  const accessPayload: JwtPayload = { userId, role, type: 'access', tv: tokenVersion };
  const refreshPayload: JwtPayload = { userId, role, type: 'refresh', tv: tokenVersion };
  const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '2h' });
  const refreshToken = jwt.sign(refreshPayload, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}
