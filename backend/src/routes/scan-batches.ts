import { Router, Request, Response } from 'express';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { applyBatch } from '../services/batch-applier';
import { ScanBatch, ScanBatchItem } from '../types';
import { isPathInsideRoot } from '../utils/path-safe';

const router = Router();

const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
const PREVIEW_BYTES = 2048;

// 收集 payload 中出现的所有文件路径（file_path / canonical_file_path / members[].file_path）
function collectPayloadPaths(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectPayloadPaths(v, out);
  } else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'file_path' || key === 'canonical_file_path') && typeof v === 'string') out.add(v);
      else collectPayloadPaths(v, out);
    }
  }
}

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
  // 未携带 payload 时（如修改后再点「接受」）保留管理员已有的修改，只更新决定
  db.prepare(
    `UPDATE scan_batch_items SET admin_decision = ?, admin_payload = COALESCE(?, admin_payload), reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ? WHERE id = ?`
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
  const filePath = req.query.file_path;
  if (typeof filePath !== 'string' || !filePath) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }

  // 只允许预览属于该批次的文件，不信任客户端传入的任意路径
  const db = getDb();
  const rows = db.prepare('SELECT payload FROM scan_batch_items WHERE batch_id = ?')
    .all(req.params.batchId) as Array<{ payload: string }>;
  const batchPaths = new Set<string>();
  for (const row of rows) {
    try { collectPayloadPaths(JSON.parse(row.payload), batchPaths); } catch { /* 跳过损坏的 payload */ }
  }
  if (!batchPaths.has(filePath)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在');
    return;
  }

  // 解析符号链接后再校验必须位于书库目录内
  let realPath: string;
  let realRoot: string;
  try {
    realPath = fs.realpathSync(filePath);
    realRoot = fs.realpathSync(BOOKS_DIR);
  } catch {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在');
    return;
  }
  if (!isPathInsideRoot(realRoot, realPath)) {
    errorResponse(res, 403, 'AUTH_FORBIDDEN', '非法路径');
    return;
  }

  try {
    // 只读开头部分，避免为 500 字预览把整本书读进内存
    const buffer = Buffer.alloc(PREVIEW_BYTES);
    const fd = fs.openSync(realPath, 'r');
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(fd, buffer, 0, PREVIEW_BYTES, 0);
    } finally {
      fs.closeSync(fd);
    }
    const content = buffer.subarray(0, bytesRead).toString('utf-8').slice(0, 500);
    successResponse(res, { content });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '读取失败');
  }
});

export default router;
