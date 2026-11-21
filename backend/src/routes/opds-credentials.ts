import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
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

// POST /api/opds/credentials — 开通或重置，密码只在这里返回一次
router.post('/credentials', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const userId = req.user!.userId;
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
