import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import {
  createOverride,
  listOverrides,
  deleteOverride,
  deleteAllOverrides,
} from '../services/manual-override';
import { ManualOverrideType } from '../types';

const router = Router();

const createSchema = z.object({
  type: z.enum(['not_duplicate', 'not_in_series', 'forced_duplicate', 'forced_series_member']),
  book_id_a: z.string().nullable(),
  book_id_b: z.string().nullable().optional(),
  series_id: z.string().nullable().optional(),
});

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const type = req.query.type as ManualOverrideType | undefined;
  successResponse(res, listOverrides(type));
});

router.post('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }
  const ov = createOverride({ ...parsed.data, created_by: req.user!.userId });
  successResponse(res, ov, '已记录人工修正');
});

router.delete('/all', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const n = deleteAllOverrides();
  successResponse(res, { deleted: n }, '已清空所有人工修正');
});

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const ok = deleteOverride(req.params.id);
  if (!ok) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '不存在');
    return;
  }
  successResponse(res, null, '已删除');
});

export default router;
