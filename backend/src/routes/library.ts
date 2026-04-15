import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, paginatedResponse, errorResponse } from '../utils/response';
import { Book } from '../types';
import { aiManager } from '../ai/ai-manager';

const router = Router();

const ALLOWED_SORT_FIELDS = ['title', 'author', 'imported_at', 'file_size', 'category'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub', 'umd'];

// GET /api/library
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const sortBy = ALLOWED_SORT_FIELDS.includes(req.query.sortBy as string) ? (req.query.sortBy as string) : 'imported_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const db = getDb();
  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  if (search) {
    whereClause += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    whereClause += ' AND category = ?';
    params.push(category);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM books ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const offset = (page - 1) * pageSize;
  const books = db.prepare(`SELECT * FROM books ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as Book[];

  paginatedResponse(res, books, page, pageSize, total);
});

// POST /api/library/scan
router.post('/scan', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const taskId = uuidv4();

  // Run scan asynchronously
  setImmediate(async () => {
    try {
      const db = getDb();

      if (!fs.existsSync(BOOKS_DIR)) {
        return;
      }

      function scanDir(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).slice(1).toLowerCase();
            if (SUPPORTED_FORMATS.includes(ext)) {
              const existing = db.prepare('SELECT id FROM books WHERE file_path = ?').get(fullPath);
              if (!existing) {
                const stat = fs.statSync(fullPath);
                const title = path.basename(entry.name, path.extname(entry.name));
                db.prepare(
                  'INSERT INTO books (id, title, file_path, file_format, file_size) VALUES (?, ?, ?, ?, ?)'
                ).run(uuidv4(), title, fullPath, ext, stat.size);
              }
            }
          }
        }
      }

      scanDir(BOOKS_DIR);
    } catch (err) {
      console.error('Scan error:', err);
    }
  });

  successResponse(res, { taskId, status: 'scanning' }, '扫描任务已启动');
});

// GET /api/library/:id
router.get('/:id', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  successResponse(res, book);
});

const updateBookSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  author: z.string().max(100).optional(),
  cover_url: z.string().max(500).optional(),
  summary: z.string().max(5000).optional(),
  category: z.string().max(50).optional(),
  tags: z.array(z.string()).optional(),
  publish_date: z.string().max(20).optional(),
  finish_date: z.string().max(20).optional(),
  is_finished: z.boolean().optional(),
});

// PUT /api/library/:id
router.put('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = updateBookSchema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }

  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }

  const data = parsed.data;
  const updates: string[] = [];
  const values: unknown[] = [];

  if (data.title !== undefined) { updates.push('title = ?'); values.push(data.title); }
  if (data.author !== undefined) { updates.push('author = ?'); values.push(data.author); }
  if (data.cover_url !== undefined) { updates.push('cover_url = ?'); values.push(data.cover_url); }
  if (data.summary !== undefined) { updates.push('summary = ?'); values.push(data.summary); }
  if (data.category !== undefined) { updates.push('category = ?'); values.push(data.category); }
  if (data.tags !== undefined) { updates.push('tags = ?'); values.push(JSON.stringify(data.tags)); }
  if (data.publish_date !== undefined) { updates.push('publish_date = ?'); values.push(data.publish_date); }
  if (data.finish_date !== undefined) { updates.push('finish_date = ?'); values.push(data.finish_date); }
  if (data.is_finished !== undefined) { updates.push('is_finished = ?'); values.push(data.is_finished ? 1 : 0); }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book;
  successResponse(res, updated, '更新成功');
});

// DELETE /api/library/:id
router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  successResponse(res, null, '已从书库移除');
});

// POST /api/library/:id/ai-fill
router.post('/:id/ai-fill', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }

  try {
    // Clean book title: remove edition/version markers like (精校版)(完本)[全本] etc.
    const cleanedTitle = book.title
      .replace(/[(\uff08][^)\uff09]{0,20}[)\uff09]/g, '')  // remove (xxx) （xxx）
      .replace(/[[\u3010][^\]\u3011]{0,20}[\]\u3011]/g, '')  // remove [xxx] 【xxx】
      .replace(/[-_\s]*(完本|精校版?|全本|完整版|最新版|修订版|番外|特别版|典藏版)$/i, '')
      .trim() || book.title;

    // Read first 600 chars as a content hint
    let contentHint = '';
    if (fs.existsSync(book.file_path) && book.file_format === 'txt') {
      const content = fs.readFileSync(book.file_path, 'utf-8');
      contentHint = content.slice(0, 600);
    }

    // Build structured lookup request for AI
    const lookupRequest = `书名：${cleanedTitle}\n原文件名（仅参考）：${book.title}\n文本节选（仅作辅助参考）：\n${contentHint}`;

    const info = await aiManager.fillBookInfo(lookupRequest, db);
    const infoRaw = info as Record<string, unknown>;

    // Filename-based completion heuristic (fallback when AI doesn't return is_finished)
    const finishedKeywords = /完本|完结|全集|全本|完整版|精校版|完稿/;
    const isFinishedByFilename = finishedKeywords.test(book.title);

    // Determine effective completion status (AI takes priority)
    const effectiveIsFinished = (info.is_finished !== undefined) ? !!info.is_finished : isFinishedByFilename;

    // Build serialization note and append to summary
    const startDate = infoRaw.start_date as string | undefined;
    const endDate = infoRaw.end_date as string | undefined;
    const platform = infoRaw.platform as string | undefined;

    if (info.summary && startDate) {
      const platformPart = platform ? `在${platform}` : '';
      const startPart = `从${startDate}开始${platformPart}连载`;
      const serializationNote = effectiveIsFinished
        ? (endDate ? `${startPart}，于${endDate}完本。` : `${startPart}，已完本。`)
        : `${startPart}，目前还在连载中。`;
      info.summary = info.summary + '\n' + serializationNote;
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (info.title && !book.title) { updates.push('title = ?'); values.push(info.title); }
    if (info.author) { updates.push('author = ?'); values.push(info.author); }
    if (info.summary) { updates.push('summary = ?'); values.push(info.summary); }
    if (info.category) { updates.push('category = ?'); values.push(info.category); }

    // Set is_finished: AI result takes priority, filename heuristic as fallback
    const isFinished = (info.is_finished !== undefined) ? (info.is_finished ? 1 : 0)
      : isFinishedByFilename ? 1 : null;
    if (isFinished !== null) { updates.push('is_finished = ?'); values.push(isFinished); }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book;
    successResponse(res, updated, 'AI 信息填充成功');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', 'AI 填充失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

export default router;
