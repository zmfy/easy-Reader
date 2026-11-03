import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { errorResponse } from '../utils/response';
import { JwtPayload } from '../types';
import { JWT_SECRET } from '../secret';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
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

  // 以数据库为准：用户被删除或角色变更后立即生效
  const user = getDb().prepare('SELECT id, role FROM users WHERE id = ?').get(payload.userId) as
    { id: string; role: 'admin' | 'user' } | undefined;
  if (!user) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '用户不存在或已被删除');
    return;
  }

  req.user = { userId: user.id, role: user.role, type: 'access' };
  next();
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    errorResponse(res, 403, 'AUTH_FORBIDDEN', '需要管理员权限');
    return;
  }
  next();
}

export function generateTokens(userId: string, role: 'admin' | 'user'): { accessToken: string; refreshToken: string } {
  const accessPayload: JwtPayload = { userId, role, type: 'access' };
  const refreshPayload: JwtPayload = { userId, role, type: 'refresh' };
  const accessToken = jwt.sign(accessPayload, JWT_SECRET, { expiresIn: '2h' });
  const refreshToken = jwt.sign(refreshPayload, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}
