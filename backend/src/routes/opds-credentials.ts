import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { credentialLimiter } from '../middleware/rate-limit';
import { successResponse, errorResponse } from '../utils/response';
import { disableOpds, getOpdsStatus, issueOpdsPassword } from '../services/opds-credentials';
import { writeAudit } from '../services/audit-log';

// OPDS 专用密码的自助管理：每个用户只能管自己的
const router = Router();

function username(userId: string): string {
  const row = getDb().prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  return row?.username ?? '';
}

// GET /api/opds/credentials — 开通状态（不含密码）
router.get('/credentials', authMiddleware, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  successResponse(res, { ...getOpdsStatus(getDb(), userId), username: username(userId) });
});

const issueSchema = z.object({ currentPassword: z.string().min(1).max(100) });

// POST /api/opds/credentials — 开通或重置，密码只在这里返回一次。
// OPDS 密码长期有效、改登录密码也不作废，所以要求再输一次登录密码，防止令牌被盗后被人开通
router.post('/credentials', credentialLimiter, authMiddleware, (req: Request, res: Response) => {
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '请输入登录密码'); return; }
  const db = getDb();
  const userId = req.user!.userId;
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined;
  // 用 422 而非 401：401 会让客户端以为令牌失效
  if (!user || !bcrypt.compareSync(parsed.data.currentPassword, user.password_hash)) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '登录密码不正确'); return;
  }
  const wasEnabled = getOpdsStatus(db, userId).enabled;
  const password = issueOpdsPassword(db, userId);
  writeAudit({ user_id: userId, action: wasEnabled ? 'opds_reset' : 'opds_enable', resource_id: userId });
  successResponse(res, { password, username: username(userId) }, wasEnabled ? 'OPDS 密码已重置' : 'OPDS 已开通', 201);
});

// DELETE /api/opds/credentials — 关闭
router.delete('/credentials', authMiddleware, (req: Request, res: Response) => {
  const userId = req.user!.userId;
  if (!disableOpds(getDb(), userId)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '尚未开通 OPDS'); return; }
  writeAudit({ user_id: userId, action: 'opds_disable', resource_id: userId, details: { by: 'self' } });
  successResponse(res, null, 'OPDS 已关闭');
});

export default router;
