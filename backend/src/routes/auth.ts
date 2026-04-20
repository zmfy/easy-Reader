import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, generateTokens } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { JWT_SECRET } from '../secret';
import { User } from '../types';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
});

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  inviteCode: z.string().optional(),
});

// POST /api/auth/login
router.post('/login', (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }

  const { username, password } = parsed.data;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '用户名或密码错误');
    return;
  }

  const tokens = generateTokens(user.id, user.role);
  successResponse(res, {
    user: { id: user.id, username: user.username, role: user.role },
    ...tokens,
  }, '登录成功');
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (_req: Request, res: Response) => {
  successResponse(res, null, '已登出');
});

// POST /api/auth/register
router.post('/register', (req: Request, res: Response) => {
  const db = getDb();
  const settings = db.prepare("SELECT value FROM settings WHERE key = 'registration_mode'").get() as { value: string } | undefined;
  const registrationMode = settings?.value || 'invite';

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }

  const { username, password, inviteCode } = parsed.data;

  if (registrationMode === 'invite') {
    if (!inviteCode) {
      errorResponse(res, 422, 'VALIDATION_ERROR', '需要邀请码');
      return;
    }
    const code = db.prepare('SELECT * FROM invite_codes WHERE code = ? AND used_by IS NULL').get(inviteCode) as { code: string; expires_at?: string } | undefined;
    if (!code) {
      errorResponse(res, 422, 'VALIDATION_ERROR', '邀请码无效或已使用');
      return;
    }
    if (code.expires_at && new Date(code.expires_at) < new Date()) {
      errorResponse(res, 422, 'VALIDATION_ERROR', '邀请码已过期');
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      errorResponse(res, 409, 'BUSINESS_CONFLICT', '用户名已存在');
      return;
    }

    const userId = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, username, hash, 'user');
    db.prepare('UPDATE invite_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?').run(userId, inviteCode);

    const tokens = generateTokens(userId, 'user');
    successResponse(res, { user: { id: userId, username, role: 'user' }, ...tokens }, '注册成功', 201);
  } else {
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exists) {
      errorResponse(res, 409, 'BUSINESS_CONFLICT', '用户名已存在');
      return;
    }
    const userId = uuidv4();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(userId, username, hash, 'user');
    const tokens = generateTokens(userId, 'user');
    successResponse(res, { user: { id: userId, username, role: 'user' }, ...tokens }, '注册成功', 201);
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.user!.userId) as Omit<User, 'password_hash'> | undefined;
  if (!user) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在');
    return;
  }
  successResponse(res, user);
});

// POST /api/auth/refresh
router.post('/refresh', (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '未提供刷新令牌');
    return;
  }
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET) as import('../types').JwtPayload;
    const tokens = generateTokens(payload.userId, payload.role);
    successResponse(res, tokens);
  } catch {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '刷新令牌无效');
  }
});

export default router;
