import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { Book, ReadingProgress, Bookmark } from '../types';
import { listHighlights, createHighlight, updateHighlightNote, deleteHighlight } from '../services/highlights';
import { keepChain, deleteMindSubtree, addCustomNode, updateMindNode } from '../services/mind-nodes';
import { expandHighlight, AiBadOutputError, listMindNodesWithLater } from '../services/mind-expand';
import { getReaderPlugin } from '../plugins/plugin-manager';
import { isAiConfigured } from '../ai/ai-manager';
import { generateRecap, answerQuestion } from '../services/ai-reading-run';
import { getTtsConfig, getSpeech, TTS_MAX_TEXT } from '../services/tts';
import { resolveRealPathInsideRoot } from '../utils/path-safe';
import { rewriteEpubAssetUrls } from '../utils/epub-asset-url';
import { htmlToBlocks } from '../utils/content-blocks';
import DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

const router = Router();
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

// 读取书籍文件前，校验其真实路径（解析符号链接后）位于书库目录内，
// 防止登记在库的路径指向书库外的文件（如数据库、密钥）而被读出
function findReadableBook(bookId: string, res: Response): Book | null {
  const book = getDb().prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return null; }
  const realPath = resolveRealPathInsideRoot(BOOKS_DIR, book.file_path);
  if (!realPath) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '文件不存在');
    return null;
  }
  // 后续所有打开都用校验过的真实路径，避免校验后再跟随（被替换的）符号链接
  return { ...book, file_path: realPath };
}
const window = new JSDOM('').window;
// @ts-ignore
const purify = DOMPurify(window);

// Resolve a relative path (src) against a base file path (chapterHref)
// GET /api/reader/:bookId/chapters
router.get('/:bookId/chapters', authMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;

  // PDF 默认在阅读器内逐页显示；仅当管理员明确关闭（'false'）时用浏览器原生打开，
  // 原生模式由浏览器直接渲染原文件，无需 pdf-parse 全量解析
  const isPdf = book.file_format.toLowerCase() === 'pdf';
  if (isPdf) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'pdf_use_plugin'").get() as { value: string } | undefined;
    if (row?.value === 'false') {
      successResponse(res, { chapters: [], format: book.file_format, pdfUsePlugin: false });
      return;
    }
  }

  try {
    const plugin = await getReaderPlugin(book);
    const rawChapters = await plugin.getChapters();
    // Apply AI-normalized title overrides if any
    const { getOverridesMap } = await import('../services/chapter-normalize');
    const overrides = getOverridesMap(req.params.bookId);
    const chapters = overrides.size > 0
      ? rawChapters.map(c => ({ ...c, title: overrides.get(c.index) ?? c.title }))
      : rawChapters;
    const extra: Record<string, unknown> = { chapters, format: book.file_format };
    if (isPdf) extra.pdfUsePlugin = true;
    successResponse(res, extra);
  } catch (err) {
    // 底层异常可能含服务器路径（且 asset 路由无需登录），只记日志、不回显给客户端
    console.error(`[reader:chapters] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取章节');
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
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;

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
    // 底层异常可能含服务器路径（且 asset 路由无需登录），只记日志、不回显给客户端
    console.error(`[reader:asset] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取资源');
  }
});

// GET /api/reader/:bookId/raw — stream the original file (for PDF native rendering)
router.get('/:bookId/raw', authMiddleware, (req: Request, res: Response) => {
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;
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

// GET /api/reader/:bookId/chapter/:index[?format=html|blocks]
// format=blocks：返回结构化内容块（供第三方客户端排版），默认 html（网页版）
router.get('/:bookId/chapter/:index', authMiddleware, async (req: Request, res: Response) => {
  const format = req.query.format ?? 'html';
  if (format !== 'html' && format !== 'blocks') {
    errorResponse(res, 422, 'VALIDATION_ERROR', 'format 只能是 html 或 blocks'); return;
  }
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;

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
    if (format === 'blocks') {
      successResponse(res, { index, format, blocks: htmlToBlocks(safeContent) });
      return;
    }
    successResponse(res, { index, content: safeContent });
  } catch (err) {
    // 底层异常可能含服务器路径（且 asset 路由无需登录），只记日志、不回显给客户端
    console.error(`[reader:chapter] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '无法读取章节内容');
  }
});

// GET /api/reader/:bookId/progress
router.get('/:bookId/progress', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId) as ReadingProgress | undefined;
  successResponse(res, row
    ? {
      hasProgress: true,
      chapterIndex: row.chapter_index,
      chapterTitle: row.chapter_title || '',
      scrollTop: row.scroll_top,
      paragraphIndex: row.paragraph_index ?? 0,
      paragraphOffset: row.paragraph_offset ?? 0,
      // 上次阅读时间：阅读器据此判断是否隔了几天，提示「前情提要」
      updatedAt: row.updated_at ?? null,
    }
    : { hasProgress: false, chapterIndex: 0, chapterTitle: '', scrollTop: 0, paragraphIndex: 0, paragraphOffset: 0, updatedAt: null }
  );
});

// POST /api/reader/:bookId/progress
router.post('/:bookId/progress', authMiddleware, (req: Request, res: Response) => {
  const schema = z.object({
    chapterIndex: z.number().min(0).transform(v => Math.floor(v)),
    chapterTitle: z.string().max(100).optional().default(''),
    scrollTop: z.number().min(0).transform(v => Math.floor(v)),
    paragraphIndex: z.number().int().min(0).max(1_000_000).optional().default(0),
    paragraphOffset: z.number().min(0).max(1).optional().default(0),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  // 只允许为真实存在的书写入，避免用随意的 bookId 写入无限孤儿数据（也绕过每书 10 个书签的上限）
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  const existing = db.prepare('SELECT id FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId);

  if (existing) {
    db.prepare('UPDATE reading_progress SET chapter_index = ?, chapter_title = ?, scroll_top = ?, paragraph_index = ?, paragraph_offset = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND book_id = ?').run(
      parsed.data.chapterIndex, parsed.data.chapterTitle, parsed.data.scrollTop, parsed.data.paragraphIndex, parsed.data.paragraphOffset, req.user!.userId, req.params.bookId
    );
  } else {
    db.prepare('INSERT INTO reading_progress (id, user_id, book_id, chapter_index, chapter_title, scroll_top, paragraph_index, paragraph_offset) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      uuidv4(), req.user!.userId, req.params.bookId, parsed.data.chapterIndex, parsed.data.chapterTitle, parsed.data.scrollTop, parsed.data.paragraphIndex, parsed.data.paragraphOffset
    );
  }

  // Update shelf last_read_at
  db.prepare('UPDATE shelf SET last_read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND book_id = ?').run(req.user!.userId, req.params.bookId);

  const progress = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user!.userId, req.params.bookId);
  successResponse(res, progress, '进度已保存');
});

// ── 阅读器 AI：前情提要 / 问书（只用当前位置之前的内容，防剧透） ──
const aiPositionSchema = {
  chapterIndex: z.number().int().min(0).max(1_000_000),
  paragraphIndex: z.number().int().min(0).max(1_000_000).optional().default(0),
};
const AI_NOT_CONFIGURED_MSG = '未配置 AI 插件，请先在「AI 插件设置」中配置';

// POST /api/reader/:bookId/recap — 前情提要（同一位置有缓存直接返回）
router.post('/:bookId/recap', authMiddleware, async (req: Request, res: Response) => {
  const parsed = z.object(aiPositionSchema).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!isAiConfigured(db)) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', AI_NOT_CONFIGURED_MSG); return; }
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;
  try {
    successResponse(res, await generateRecap(db, book, parsed.data.chapterIndex, parsed.data.paragraphIndex));
  } catch (err) {
    console.error(`[reader:recap] book=${book.id}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '生成前情提要失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

// POST /api/reader/:bookId/ask — 问书
router.post('/:bookId/ask', authMiddleware, async (req: Request, res: Response) => {
  const parsed = z.object({
    ...aiPositionSchema,
    question: z.string().trim().min(1).max(500),
    history: z.array(z.object({ q: z.string().max(500), a: z.string().max(2000) })).max(10).optional().default([]),
  }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!isAiConfigured(db)) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', AI_NOT_CONFIGURED_MSG); return; }
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;
  try {
    successResponse(res, await answerQuestion(db, book, parsed.data));
  } catch (err) {
    console.error(`[reader:ask] book=${book.id}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '问书失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

// POST /api/reader/:bookId/tts — 听书：合成一段文字的语音（mp3），按文本缓存
router.post('/:bookId/tts', authMiddleware, async (req: Request, res: Response) => {
  const parsed = z.object({ text: z.string().trim().min(1).max(TTS_MAX_TEXT) }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!getTtsConfig(db).enabled) { errorResponse(res, 400, 'TTS_DISABLED', '听书功能未开启，请在「AI 插件设置 → MiniMax」中开启'); return; }
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.bookId)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }
  try {
    const audio = await getSpeech(db, req.params.bookId, parsed.data.text);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' }).send(audio);
  } catch (err) {
    console.error(`[reader:tts] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '语音合成失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
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
  // 只允许为真实存在的书写入，避免用随意的 bookId 写入无限孤儿数据（也绕过每书 10 个书签的上限）
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
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

// GET /api/reader/:bookId/highlights
router.get('/:bookId/highlights', authMiddleware, (req: Request, res: Response) => {
  successResponse(res, listHighlights(getDb(), req.user!.userId, req.params.bookId));
});

// POST /api/reader/:bookId/highlights
router.post('/:bookId/highlights', authMiddleware, (req: Request, res: Response) => {
  const schema = z.object({
    chapterIndex: z.number().int().min(0),
    startOffset: z.number().int().min(0),
    endOffset: z.number().int().min(0),
    text: z.string().min(1).max(1000),
    note: z.string().max(2000).nullish(),
  }).refine(v => v.endOffset > v.startOffset);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  const { note, ...rest } = parsed.data;
  const highlight = createHighlight(db, req.user!.userId, req.params.bookId, { ...rest, note: note ?? undefined });
  successResponse(res, highlight, '划线已添加', 201);
});

// PATCH /api/reader/:bookId/highlights/:id
router.patch('/:bookId/highlights/:id', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({ note: z.string().max(2000).nullable() }).safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const highlight = updateHighlightNote(getDb(), req.user!.userId, req.params.bookId, req.params.id, parsed.data.note);
  if (!highlight) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '划线不存在'); return; }
  successResponse(res, highlight, '批注已更新');
});

// DELETE /api/reader/:bookId/highlights/:id
router.delete('/:bookId/highlights/:id', authMiddleware, (req: Request, res: Response) => {
  if (!deleteHighlight(getDb(), req.user!.userId, req.params.bookId, req.params.id)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '划线不存在');
    return;
  }
  successResponse(res, null, '划线已删除');
});

// POST /api/reader/:bookId/highlights/:id/expand — AI 展开划线（或其下某个知识点）
router.post('/:bookId/highlights/:id/expand', authMiddleware, async (req: Request, res: Response) => {
  const parsed = z.object({
    center: z.string().trim().min(1).max(60).optional(),
    path: z.array(z.string().max(60)).max(10).optional(),
    force: z.boolean().optional(),
  }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!isAiConfigured(db)) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', AI_NOT_CONFIGURED_MSG); return; }
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;
  try {
    const result = await expandHighlight(db, book, req.user!.userId, { highlightId: req.params.id, ...parsed.data });
    if (!result) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '划线不存在'); return; }
    successResponse(res, result);
  } catch (err) {
    if (err instanceof AiBadOutputError) {
      errorResponse(res, 422, 'AI_BAD_OUTPUT', 'AI 返回格式不正确，请重试');
      return;
    }
    console.error(`[reader:expand] book=${book.id}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', 'AI 展开失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

// GET /api/reader/:bookId/mind-nodes?highlightId= — 每个节点附 source_later（出处在当前用户阅读边界之后）
router.get('/:bookId/mind-nodes', authMiddleware, async (req: Request, res: Response) => {
  const highlightId = typeof req.query.highlightId === 'string' && req.query.highlightId ? req.query.highlightId : undefined;
  const book = findReadableBook(req.params.bookId, res);
  if (!book) return;
  try {
    successResponse(res, await listMindNodesWithLater(getDb(), book, req.user!.userId, highlightId));
  } catch (err) {
    console.error(`[reader:mind-nodes] book=${book.id}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '读取导图节点失败');
  }
});

// POST /api/reader/:bookId/mind-nodes/keep — 保留一条知识点链
router.post('/:bookId/mind-nodes/keep', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({
    highlightId: z.string().min(1),
    chain: z.array(z.object({
      label: z.string().min(1).max(60),
      kind: z.enum(['event', 'concept', 'person']),
      summary: z.string().max(200).optional(),
      source: z.object({
        chapterIndex: z.number().int().min(0),
        paragraphIndex: z.number().int().min(0),
      }).nullish(),
    })).min(1).max(10),
  }).safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const nodes = keepChain(getDb(), req.user!.userId, req.params.bookId, parsed.data.highlightId, parsed.data.chain);
  if (!nodes) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '划线不存在'); return; }
  successResponse(res, nodes, '已保留到导图');
});

// POST /api/reader/:bookId/mind-nodes — 手动添加节点（parentId 与 chapterIndex 恰好给一个）
router.post('/:bookId/mind-nodes', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({
    parentId: z.string().min(1).optional(),
    chapterIndex: z.number().int().min(0).optional(),
    label: z.string().trim().min(1).max(60),
    note: z.string().max(2000).optional(),
  }).refine(v => (v.parentId === undefined) !== (v.chapterIndex === undefined)).safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM books WHERE id = ?').get(req.params.bookId)) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  const node = addCustomNode(db, req.user!.userId, req.params.bookId, parsed.data);
  if (!node) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '父节点不存在'); return; }
  successResponse(res, node, '节点已添加', 201);
});

// PATCH /api/reader/:bookId/mind-nodes/:id — 改名 / 批注
router.patch('/:bookId/mind-nodes/:id', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({
    label: z.string().trim().min(1).max(60).optional(),
    note: z.string().max(2000).nullable().optional(),
  }).refine(v => v.label !== undefined || v.note !== undefined).safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const node = updateMindNode(getDb(), req.user!.userId, req.params.bookId, req.params.id, parsed.data);
  if (!node) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '节点不存在'); return; }
  if (node === 'FORBIDDEN') { errorResponse(res, 403, 'FORBIDDEN', '划线节点不能改名'); return; }
  successResponse(res, node, '节点已更新');
});

// DELETE /api/reader/:bookId/mind-nodes/:id — 删除节点及其子树
router.delete('/:bookId/mind-nodes/:id', authMiddleware, (req: Request, res: Response) => {
  const deleted = deleteMindSubtree(getDb(), req.user!.userId, req.params.bookId, req.params.id);
  if (deleted === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '节点不存在'); return; }
  successResponse(res, { deleted }, '节点已删除');
});

export default router;
