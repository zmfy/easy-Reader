import { Router, Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse } from '../utils/response';
import { queryAudit } from '../services/audit-log';
import { AuditAction } from '../types';

const router = Router();

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const action = req.query.action as AuditAction | undefined;
  const user_id = req.query.user_id as string | undefined;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
  successResponse(res, queryAudit({ action, user_id, limit, offset }));
});

export default router;
