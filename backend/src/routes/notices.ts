import { Router, Request, Response } from 'express';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { listNotices, markNoticeRead, markAllNoticesRead } from '../services/notices';

// 后台任务通知（铃铛）：仅管理员
const router = Router();

// GET /api/notices — 最近的通知与未读数
router.get('/', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, listNotices());
});

// POST /api/notices/read-all — 全部标为已读
router.post('/read-all', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, { read: markAllNoticesRead() });
});

// POST /api/notices/:id/read — 标为已读
router.post('/:id/read', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  if (!markNoticeRead(req.params.id)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '通知不存在或已读'); return; }
  successResponse(res, { read: 1 });
});

export default router;
