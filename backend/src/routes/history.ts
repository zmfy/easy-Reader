import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import { withDisplayTitle } from '../utils/book-view';
import { clearHistory, listHistory, recordOpen, removeHistory } from '../services/reading-history';

// 阅读历史：每个用户只看到自己的
const router = Router();

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

// GET /api/history — 最近打开的在前，附阅读进度
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { page, pageSize } = parsed.data;
  const { items, total } = listHistory(getDb(), req.user!.userId, page, pageSize);
  paginatedResponse(res, withDisplayTitle(items), page, pageSize, total);
});

// POST /api/history/:bookId — 记一次打开（阅读器进入时调用）
router.post('/:bookId', authMiddleware, (req: Request, res: Response) => {
  if (!recordOpen(getDb(), req.user!.userId, req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  successResponse(res, null, '已记录');
});

// DELETE /api/history — 清空历史（不影响阅读进度和书架）
router.delete('/', authMiddleware, (req: Request, res: Response) => {
  successResponse(res, { removed: clearHistory(getDb(), req.user!.userId) }, '已清空阅读历史');
});

// DELETE /api/history/:bookId — 从历史移除一本
router.delete('/:bookId', authMiddleware, (req: Request, res: Response) => {
  if (!removeHistory(getDb(), req.user!.userId, req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '历史中没有这本书');
    return;
  }
  successResponse(res, null, '已从历史移除');
});

export default router;
