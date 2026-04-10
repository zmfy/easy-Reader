import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';

const router = Router();

// GET /api/shelf
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const items = db.prepare(`
    SELECT s.*, b.title, b.author, b.cover_url, b.category, b.file_format,
           rp.chapter_index, rp.chapter_title, rp.scroll_top, rp.updated_at as progress_updated_at
    FROM shelf s
    JOIN books b ON s.book_id = b.id
    LEFT JOIN reading_progress rp ON rp.user_id = s.user_id AND rp.book_id = s.book_id
    WHERE s.user_id = ?
    ORDER BY COALESCE(s.last_read_at, s.added_at) DESC
  `).all(req.user!.userId);
  successResponse(res, items);
});

// POST /api/shelf
router.post('/', authMiddleware, (req: Request, res: Response) => {
  const schema = z.object({ bookId: z.string().uuid() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }

  const db = getDb();
  const book = db.prepare('SELECT id FROM books WHERE id = ?').get(parsed.data.bookId);
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }

  const existing = db.prepare('SELECT id FROM shelf WHERE user_id = ? AND book_id = ?').get(req.user!.userId, parsed.data.bookId);
  if (existing) {
    errorResponse(res, 409, 'BUSINESS_CONFLICT', '书籍已在书架中');
    return;
  }

  const id = uuidv4();
  db.prepare('INSERT INTO shelf (id, user_id, book_id) VALUES (?, ?, ?)').run(id, req.user!.userId, parsed.data.bookId);
  const item = db.prepare('SELECT * FROM shelf WHERE id = ?').get(id);
  successResponse(res, item, '已添加到书架', 201);
});

// DELETE /api/shelf/:bookId
router.delete('/:bookId', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM shelf WHERE user_id = ? AND book_id = ?').run(req.user!.userId, req.params.bookId);
  if (result.changes === 0) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书架中未找到该书籍');
    return;
  }
  successResponse(res, null, '已从书架移除');
});

export default router;
