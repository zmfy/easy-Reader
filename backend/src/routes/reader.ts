import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { Book, ReadingProgress, Bookmark } from '../types';
import { getReaderPlugin } from '../plugins/plugin-manager';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const router = Router();
const window = new JSDOM('').window;
// @ts-ignore
const purify = DOMPurify(window);

// Resolve a relative path (src) against a base file path (chapterHref)
function resolveEpubPath(chapterHref: string, src: string): string {
  const dir = chapterHref.split('/').slice(0, -1);
  const parts = [...dir, ...src.split('/')];
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

// Replace relative img src with API asset URLs so the browser can load them
function rewriteEpubAssetUrls(content: string, bookId: string, chapterHref: string): string {
  return content.replace(
    /(<img\b[^>]*?\s)src="([^"]+)"([^>]*>)/gi,
    (_match, pre, src, post) => {
      if (/^(https?:|data:|\/)/i.test(src)) return _match;
      const resolved = resolveEpubPath(chapterHref, src);
      return `${pre}src="/api/reader/${bookId}/asset/${resolved}"${post}`;
    }
  );
}

// GET /api/reader/:bookId/chapters
router.get('/:bookId/chapters', authMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  try {
    const plugin = await getReaderPlugin(book);
    const chapters = await plugin.getChapters();
    const extra: Record<string, unknown> = { chapters, format: book.file_format };
    if (book.file_format.toLowerCase() === 'pdf') {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'pdf_use_plugin'").get() as { value: string } | undefined;
      extra.pdfUsePlugin = row?.value === 'true';
    }
    successResponse(res, extra);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取章节: ' + (err instanceof Error ? err.message : ''));
  }
});

// Only serve raster image types — SVG is excluded because it can embed scripts,
// and text/* / application/* are excluded to prevent XSS via attacker-controlled manifest MIME types.
const ALLOWED_ASSET_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

// GET /api/reader/:bookId/asset/* — serve embedded EPUB assets (images, etc.)
// No authMiddleware: browsers load <img src="..."> without Authorization headers.
// BookId is a UUID (unguessable), content is non-sensitive book images — acceptable for a personal NAS reader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
router.get('/:bookId/asset/*', async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  const assetPath = (req.params as any)[0] as string;
  if (!assetPath) { errorResponse(res, 400, 'VALIDATION_ERROR', '资源路径不能为空'); return; }

  try {
    const plugin = await getReaderPlugin(book);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const epubPlugin = plugin as any;
    if (typeof epubPlugin.getAsset !== 'function') {
      errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '该格式不支持内嵌资源'); return;
    }
    const asset: { buffer: Buffer; mimeType: string } | null = await epubPlugin.getAsset(assetPath);
    if (!asset) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '资源不存在'); return; }

    // Reject any MIME type not on the allowlist — manifest values are attacker-controlled
    // and could carry text/html or application/xhtml+xml to achieve XSS on this origin.
    if (!ALLOWED_ASSET_MIME.has(asset.mimeType.toLowerCase())) {
      errorResponse(res, 415, 'UNSUPPORTED_MEDIA_TYPE', '不支持的资源类型'); return;
    }

    res.setHeader('Content-Type', asset.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(asset.buffer);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取资源: ' + (err instanceof Error ? err.message : ''));
  }
});

// GET /api/reader/:bookId/raw — stream the original file (for PDF native rendering)
router.get('/:bookId/raw', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }
  if (!fs.existsSync(book.file_path)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在'); return; }

  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
  };
  const mime = mimeMap[book.file_format.toLowerCase()] || 'application/octet-stream';
  const stat = fs.statSync(book.file_path);

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(book.file_path).pipe(res);
});

// GET /api/reader/:bookId/chapter/:index
router.get('/:bookId/chapter/:index', authMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0) { errorResponse(res, 422, 'VALIDATION_ERROR', '无效章节索引'); return; }

  try {
    const plugin = await getReaderPlugin(book);
    const rawContent = await plugin.getChapterContent(index);
    let processedContent = rawContent;
    if (book.file_format.toLowerCase() === 'epub') {
      const chapters = await plugin.getChapters();
      const chapterHref = chapters[index]?.href || '';
      processedContent = rewriteEpubAssetUrls(rawContent, book.id, chapterHref);
    }
    const safeContent = purify.sanitize(processedContent);
    successResponse(res, { index, content: safeContent });
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取章节内容: ' + (err instanceof Error ? err.message : ''));
  }
});

// GET /api/reader/:bookId/progress
router.get('/:bookId/progress', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId) as ReadingProgress | undefined;
  successResponse(res, row
    ? { chapterIndex: row.chapter_index, chapterTitle: row.chapter_title || '', scrollTop: row.scroll_top }
    : { chapterIndex: 0, chapterTitle: '', scrollTop: 0 }
  );
});

// POST /api/reader/:bookId/progress
router.post('/:bookId/progress', authMiddleware, (req: Request, res: Response) => {
  const schema = z.object({
    chapterIndex: z.number().min(0).transform(v => Math.floor(v)),
    chapterTitle: z.string().max(100).optional().default(''),
    scrollTop: z.number().min(0).transform(v => Math.floor(v)),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId);

  if (existing) {
    db.prepare('UPDATE reading_progress SET chapter_index = ?, chapter_title = ?, scroll_top = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND book_id = ?').run(
      parsed.data.chapterIndex, parsed.data.chapterTitle, parsed.data.scrollTop, req.user!.userId, req.params.bookId
    );
  } else {
    db.prepare('INSERT INTO reading_progress (id, user_id, book_id, chapter_index, chapter_title, scroll_top) VALUES (?, ?, ?, ?, ?, ?)').run(
      uuidv4(), req.user!.userId, req.params.bookId, parsed.data.chapterIndex, parsed.data.chapterTitle, parsed.data.scrollTop
    );
  }

  // Update shelf last_read_at
  db.prepare('UPDATE shelf SET last_read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND book_id = ?').run(req.user!.userId, req.params.bookId);

  const progress = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId);
  successResponse(res, progress, '进度已保存');
});

// GET /api/reader/:bookId/bookmarks
router.get('/:bookId/bookmarks', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC').all(req.user!.userId, req.params.bookId) as Bookmark[];
  successResponse(res, bookmarks);
});

// POST /api/reader/:bookId/bookmarks
router.post('/:bookId/bookmarks', authMiddleware, (req: Request, res: Response) => {
  const schema = z.object({
    chapterIndex: z.number().int().min(0),
    scrollTop: z.number().int().min(0),
    note: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const id = uuidv4();
  db.prepare('INSERT INTO bookmarks (id, user_id, book_id, chapter_index, scroll_top, note) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, req.user!.userId, req.params.bookId, parsed.data.chapterIndex, parsed.data.scrollTop, parsed.data.note || null
  );

  // Auto-prune: keep only the 10 most recent bookmarks per user per book
  db.prepare(`
    DELETE FROM bookmarks WHERE user_id = ? AND book_id = ? AND id NOT IN (
      SELECT id FROM bookmarks WHERE user_id = ? AND book_id = ?
      ORDER BY created_at DESC LIMIT 10
    )
  `).run(req.user!.userId, req.params.bookId, req.user!.userId, req.params.bookId);

  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(id);
  successResponse(res, bookmark, '书签已添加', 201);
});

// DELETE /api/reader/:bookId/bookmarks/:id
router.delete('/:bookId/bookmarks/:id', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM bookmarks WHERE id = ? AND user_id = ? AND book_id = ?').run(req.params.id, req.user!.userId, req.params.bookId);
  if (result.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书签不存在'); return; }
  successResponse(res, null, '书签已删除');
});

export default router;
