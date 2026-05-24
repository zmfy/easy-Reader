import { Router, Request, Response } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { applyBatch } from '../services/batch-applier';
import { ScanBatch, ScanBatchItem } from '../types';

const router = Router();

router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const status = (req.query.status as string) || undefined;
  const db = getDb();
  const rows = status
    ? db.prepare('SELECT * FROM scan_batches WHERE status = ? ORDER BY created_at DESC').all(status) as ScanBatch[]
    : db.prepare('SELECT * FROM scan_batches ORDER BY created_at DESC').all() as ScanBatch[];
  successResponse(res, rows);
});

router.get('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM scan_batches WHERE id = ?').get(req.params.id) as ScanBatch | undefined;
  if (!batch) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在'); return; }
  const items = db.prepare(
    'SELECT * FROM scan_batch_items WHERE batch_id = ? ORDER BY type, id'
  ).all(req.params.id) as ScanBatchItem[];
  successResponse(res, { batch, items });
});

const itemPatchSchema = z.object({
  decision: z.enum(['accept', 'reject', 'modified']),
  payload: z.unknown().optional(),
});

router.patch('/:batchId/items/:itemId', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = itemPatchSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  const item = db.prepare('SELECT id FROM scan_batch_items WHERE id = ? AND batch_id = ?')
    .get(req.params.itemId, req.params.batchId);
  if (!item) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '审核项不存在'); return; }
  db.prepare(
    `UPDATE scan_batch_items SET admin_decision = ?, admin_payload = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`
  ).run(
    parsed.data.decision,
    parsed.data.payload !== undefined ? JSON.stringify(parsed.data.payload) : null,
    req.user!.userId,
    req.params.itemId,
  );
  successResponse(res, null, '已记录修正');
});

router.post('/:id/apply', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const batch = db.prepare('SELECT id, status FROM scan_batches WHERE id = ?').get(req.params.id) as
    | { id: string; status: string }
    | undefined;
  if (!batch) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在'); return; }
  if (batch.status !== 'pending') { errorResponse(res, 409, 'BATCH_ALREADY_APPLIED', '批次状态非 pending'); return; }
  try {
    const result = applyBatch(req.params.id, req.user!.userId);
    successResponse(res, result, '已应用');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const r = db.prepare("UPDATE scan_batches SET status = 'discarded' WHERE id = ? AND status = 'pending'")
    .run(req.params.id);
  if (r.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '批次不存在或已处理'); return; }
  successResponse(res, null, '已废弃');
});

router.get('/:batchId/preview', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const filePath = req.query.file_path as string;
  if (!filePath || !fs.existsSync(filePath)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在');
    return;
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8').slice(0, 500);
    successResponse(res, { content });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '读取失败');
  }
});

export default router;
