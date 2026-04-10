import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { errorResponse } from '../utils/response';
import { JwtPayload } from '../types';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '未提供认证令牌');
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '令牌无效或已过期');
  }
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== 'admin') {
    errorResponse(res, 403, 'AUTH_FORBIDDEN', '需要管理员权限');
    return;
  }
  next();
}

export function generateTokens(userId: string, role: 'admin' | 'user'): { accessToken: string; refreshToken: string } {
  const payload: JwtPayload = { userId, role };
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '30m' });
  const refreshToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}
