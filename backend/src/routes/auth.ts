import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomUUID as uuidv4 } from 'crypto';
import { z } from 'zod';
import { getDb } from '../db';
import { authAllowingPasswordChange, generateTokens, verifyRefreshToken } from '../middleware/auth';
import { credentialLimiter, registerLimiter, refreshLimiter } from '../middleware/rate-limit';
import { strongPasswordSchema } from '../utils/password-policy';
import { successResponse, errorResponse } from '../utils/response';
import { User } from '../types';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(100),
  newPassword: strongPasswordSchema,
});

const registerSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  inviteCode: z.string().optional(),
});

// POST /api/auth/login
router.post('/login', credentialLimiter, (req: Request, res: Response) => {
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

  const tokens = generateTokens(user.id, user.role, user.token_version ?? 0);
  successResponse(res, {
    // mustChangePassword 为 true 时（仍是默认密码），除改密码外的接口都会返回 403，客户端应先引导改密码
    user: { id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.must_change_password },
    ...tokens,
  }, '登录成功');
});

// POST /api/auth/logout
router.post('/logout', authAllowingPasswordChange, (_req: Request, res: Response) => {
  successResponse(res, null, '已登出');
});

// POST /api/auth/register
router.post('/register', registerLimiter, (req: Request, res: Response) => {
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
router.get('/me', authAllowingPasswordChange, (req: Request, res: Response) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, role, created_at, must_change_password FROM users WHERE id = ?').get(req.user!.userId) as
    (Omit<User, 'password_hash'> & { must_change_password?: number }) | undefined;
  if (!user) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在');
    return;
  }
  const { must_change_password, ...rest } = user;
  successResponse(res, { ...rest, mustChangePassword: !!must_change_password });
});

// POST /api/auth/password — 修改自己的密码（默认密码账号也可调用）
// 成功后该账号其他设备上的令牌全部失效，返回给当前设备一组新令牌
router.post('/password', credentialLimiter, authAllowingPasswordChange, (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || '参数校验失败');
    return;
  }
  const { currentPassword, newPassword } = parsed.data;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.userId) as User | undefined;
  if (!user) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在'); return; }
  // 用 422 而非 401：401 会让客户端以为令牌失效而去续期 / 退出登录
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '当前密码不正确');
    return;
  }
  if (newPassword === currentPassword) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '新密码不能与当前密码相同');
    return;
  }

  const tokenVersion = (user.token_version ?? 0) + 1;
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = ? WHERE id = ?')
    .run(bcrypt.hashSync(newPassword, 10), tokenVersion, user.id);
  successResponse(res, {
    user: { id: user.id, username: user.username, role: user.role, mustChangePassword: false },
    ...generateTokens(user.id, user.role, tokenVersion),
  }, '密码已修改');
});

// POST /api/auth/refresh
router.post('/refresh', refreshLimiter, (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '未提供刷新令牌');
    return;
  }
  // 以数据库中的当前角色与令牌版本签发：已删除用户或已改密码（令牌已吊销）都不能续期
  const user = verifyRefreshToken(refreshToken);
  if (!user) {
    errorResponse(res, 401, 'AUTH_UNAUTHORIZED', '刷新令牌无效或已失效');
    return;
  }
  successResponse(res, generateTokens(user.id, user.role, user.token_version));
});

export default router;
