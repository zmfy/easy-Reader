import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { Series, Book } from '../types';

const router = Router();

router.get('/', authMiddleware, (_req: Request, res: Response) => {
  const list = getDb().prepare('SELECT * FROM series ORDER BY name').all() as Series[];
  const enriched = list.map(s => {
    const members = getDb().prepare(
      "SELECT cover_url FROM books WHERE series_id = ? AND status != 'duplicate' ORDER BY title LIMIT 1"
    ).get(s.id) as { cover_url?: string } | undefined;
    const count = (getDb().prepare(
      "SELECT COUNT(*) as c FROM books WHERE series_id = ? AND status != 'duplicate'"
    ).get(s.id) as { c: number }).c;
    return { ...s, member_count: count, cover_url: s.cover_url ?? members?.cover_url ?? null };
  });
  successResponse(res, enriched);
});

router.get('/:id', authMiddleware, (req: Request, res: Response) => {
  const series = getDb().prepare('SELECT * FROM series WHERE id = ?').get(req.params.id) as Series | undefined;
  if (!series) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '系列不存在'); return; }
  const members = getDb().prepare(
    'SELECT * FROM books WHERE series_id = ? ORDER BY title'
  ).all(req.params.id) as Book[];
  successResponse(res, { series, members });
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  summary: z.string().max(5000).optional(),
  cover_url: z.string().max(500).optional(),
});

router.put('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const updates: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { updates.push(`${k} = ?`); values.push(v); }
  }
  if (updates.length === 0) { successResponse(res, null, '无变化'); return; }
  values.push(req.params.id);
  const r = getDb().prepare(`UPDATE series SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  if (r.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '系列不存在'); return; }
  const series = getDb().prepare('SELECT * FROM series WHERE id = ?').get(req.params.id) as Series;
  successResponse(res, series, '已更新');
});

export default router;
