import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, paginatedResponse, errorResponse } from '../utils/response';
import { Book, ScanOptions } from '../types';
import { aiManager } from '../ai/ai-manager';
import {
  createScanTask,
  getActiveScanTask,
  getScanTaskById,
  cancelScanTask,
  hasRunningTask,
  setScanProgress,
  finishScanTask,
} from '../services/scan-task';
import { runScanTask } from '../services/scan-walker';
import { fetchAndSaveCover } from '../utils/cover';
import { deleteBookCascade, getDuplicatesOf, countAffectedUsers } from '../services/file-deleter';
import { markFieldsAsEdited, batchFill, selectFillCandidates, resetAllFills } from '../services/ai-batch-fill';
import { selectDuplicateGroupBooks } from '../services/duplicate-view';
import { estimateFromCurrentDb } from '../services/cost-estimator';
import { saveMetadata, getMetadata, extractMetadataFromAiResponse } from '../services/book-ai-metadata';
import { matchTitlesToBooks, LibraryBookForLookup } from '../services/title-lookup';

const router = Router();

const ALLOWED_SORT_FIELDS = ['title', 'author', 'imported_at', 'file_size', 'category'];
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
const SUPPORTED_FORMATS = ['txt', 'pdf', 'epub', 'umd'];

// GET /api/library
// status query: defaults to "normal-only" (hides duplicate + garbled).
//   ?status=problems → only books with status in ('duplicate','garbled')
//   ?status=garbled  → only garbled
//   ?status=duplicate → only duplicates
//   ?status=all      → no status filter (admin debug)
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
  const search = (req.query.search as string) || '';
  const category = (req.query.category as string) || '';
  const statusFilter = (req.query.status as string) || 'normal';
  const includeDirty = req.query.include_dirty === '1' || req.query.include_dirty === 'true';
  const seriesGrouped = req.query.series_grouped === '1' || req.query.series_grouped === 'true';
  const aiFill = (req.query.ai_fill as string) || 'all';
  const sortBy = ALLOWED_SORT_FIELDS.includes(req.query.sortBy as string) ? (req.query.sortBy as string) : 'imported_at';
  const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const db = getDb();

  if (statusFilter === 'duplicate_groups') {
    const { rows, total } = selectDuplicateGroupBooks(db, pageSize, (page - 1) * pageSize);
    paginatedResponse(res, rows as unknown as Book[], page, pageSize, total);
    return;
  }

  let whereClause = 'WHERE 1=1';
  const params: unknown[] = [];

  // status filter: problems/garbled/duplicate are explicit (ProblemBooks view).
  // include_dirty=true is an alias for status=all (show dirty books in mainline list).
  if (statusFilter === 'problems') {
    whereClause += " AND status IN ('duplicate','garbled')";
  } else if (statusFilter === 'garbled') {
    whereClause += " AND status = 'garbled'";
  } else if (statusFilter === 'duplicate') {
    whereClause += " AND status = 'duplicate'";
  } else if (statusFilter === 'all' || includeDirty) {
    // no status filter
  } else {
    // default: normal-only library view — hide duplicate + garbled
    whereClause += " AND (status IS NULL OR status NOT IN ('duplicate','garbled'))";
  }

  // series_grouped: exclude books that are part of a series (SeriesCard shows them separately)
  if (seriesGrouped) {
    whereClause += " AND (series_id IS NULL OR series_id = '')";
  }

  if (aiFill === 'filled') {
    whereClause += " AND ai_fill_status = 'filled'";
  } else if (aiFill === 'failed') {
    whereClause += " AND ai_fill_status = 'failed'";
  } else if (aiFill === 'none') {
    whereClause += " AND ai_fill_status IS NULL";
  }

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

const scanOptionsSchema = z.object({
  mode: z.enum(['auto', 'review']).default('review'),
  ai_fill: z.boolean().default(false),
  full_rescan: z.boolean().default(false),
});

const estimateSchema = z.object({
  ai_fill: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  full_rescan: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  force: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
});

// GET /api/library/scan/estimate — pre-scan cost estimation
router.get('/scan/estimate', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = estimateSchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const result = estimateFromCurrentDb({
    ai_fill: !!parsed.data.ai_fill,
    full_rescan: !!parsed.data.full_rescan,
    force: !!parsed.data.force,
  });
  successResponse(res, result);
});

// POST /api/library/scan
router.post('/scan', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  if (hasRunningTask()) {
    const active = getActiveScanTask()!;
    res.status(409).json({
      success: false,
      code: 'TASK_RUNNING',
      message: '已有扫描任务在运行',
      data: { activeTaskId: active.id },
    });
    return;
  }

  // Reject if any pending batch exists (force admin to handle prior results first)
  const pendingBatch = getDb().prepare("SELECT id FROM scan_batches WHERE status = 'pending' LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (pendingBatch) {
    res.status(409).json({
      success: false,
      code: 'PENDING_BATCH',
      message: '请先处理待审核批次',
      data: { pendingBatchId: pendingBatch.id },
    });
    return;
  }

  const parsed = scanOptionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }
  const options: ScanOptions = parsed.data;

  const task = createScanTask(req.user!.userId, options);

  // Fire and forget
  setImmediate(() => {
    void runScanTask(task.id, options);
  });

  successResponse(res, { taskId: task.id, status: task.status }, '扫描任务已启动');
});

const aiFillBatchSchema = z.object({ force: z.boolean().default(false) });

// POST /api/library/ai-fill-batch — admin-triggered batch AI fill over the library
router.post('/ai-fill-batch', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = aiFillBatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { force } = parsed.data;

  let task;
  try {
    // Reuse scan-task machinery so the existing progress bar works.
    task = createScanTask(req.user!.userId, { mode: 'review', ai_fill: true, full_rescan: false });
  } catch {
    const active = getActiveScanTask()!;
    res.status(409).json({ success: false, code: 'TASK_RUNNING', message: '已有扫描/填充任务在运行', data: { activeTaskId: active.id } });
    return;
  }

  const taskId = task.id;

  // Fire and forget.
  setImmediate(() => {
    void (async () => {
      try {
        const db = getDb();
        setScanProgress(taskId, { stage: 'ai_fill' });
        const toFill = selectFillCandidates(db, force);
        if (toFill.length > 0) {
          await batchFill({ taskId, user_id: req.user!.userId, books: toFill });
        }
        finishScanTask(taskId, 'completed');
      } catch (e) {
        finishScanTask(taskId, 'failed', (e as Error).message);
      }
    })();
  });

  successResponse(res, { taskId, status: 'running' }, '批量填充任务已启动');
});

// POST /api/library/ai-fill-reset-failed — admin: requeue books whose AI fill failed
router.post('/ai-fill-reset-failed', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const r = getDb().prepare(
    "UPDATE books SET ai_fill_version = NULL, ai_fill_status = NULL WHERE ai_fill_status = 'failed'"
  ).run();
  successResponse(res, { reset: r.changes }, '已重置填充失败记录');
});

// POST /api/library/ai-fill-reset-all — admin: clear ALL fill stamps (re-fill everything next scan)
router.post('/ai-fill-reset-all', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const reset = resetAllFills(getDb());
  successResponse(res, { reset });
});

// GET /api/library/scan/tasks/active
router.get('/scan/tasks/active', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const active = getActiveScanTask();
  successResponse(res, active);
});

// GET /api/library/scan/tasks/:id
router.get('/scan/tasks/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const task = getScanTaskById(req.params.id);
  if (!task) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '任务不存在');
    return;
  }
  successResponse(res, task);
});

// POST /api/library/scan/tasks/:id/cancel
router.post('/scan/tasks/:id/cancel', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const task = getScanTaskById(req.params.id);
  if (!task) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '任务不存在');
    return;
  }
  cancelScanTask(req.params.id);
  successResponse(res, null, '任务取消请求已发出');
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

  // Track which fields admin manually edited so AI batch fill won't overwrite
  const editedFields: Array<'title' | 'author' | 'summary' | 'category'> = [];
  if (data.title !== undefined) editedFields.push('title');
  if (data.author !== undefined) editedFields.push('author');
  if (data.summary !== undefined) editedFields.push('summary');
  if (data.category !== undefined) editedFields.push('category');
  if (editedFields.length > 0) {
    markFieldsAsEdited(req.params.id, editedFields);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book;
  successResponse(res, updated, '更新成功');
});

const deleteQuerySchema = z.object({
  cascade_duplicates: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  confirm_shelf_impact: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
});

// DELETE /api/library/:id?cascade_duplicates=true&confirm_shelf_impact=true
//   - Validates path is inside BOOKS_DIR (path traversal protection)
//   - If book is a canonical with duplicates pointing to it → 409 unless cascade_duplicates=true
//   - If any of the books are on any user's shelf → 409 unless confirm_shelf_impact=true
//   - Deletes disk file(s) + DB rows in a transaction; writes audit_log entry
router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = deleteQuerySchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { cascade_duplicates, confirm_shelf_impact } = parsed.data;

  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  const dups = getDuplicatesOf(req.params.id);
  if (dups.length > 0 && !cascade_duplicates) {
    res.status(409).json({
      success: false,
      code: 'HAS_DUPLICATES',
      message: '该书有重复关联，请确认是否级联删除',
      data: { duplicate_count: dups.length, requires: 'cascade_duplicates' },
    });
    return;
  }

  const allIds = [req.params.id, ...dups.map(d => d.id)];
  const affectedUsers = countAffectedUsers(allIds);
  if (affectedUsers > 0 && !confirm_shelf_impact) {
    res.status(409).json({
      success: false,
      code: 'AFFECTS_SHELF',
      message: `该书已被 ${affectedUsers} 个用户加入书架`,
      data: { affected_users: affectedUsers, requires: 'confirm_shelf_impact' },
    });
    return;
  }

  try {
    const result = deleteBookCascade({
      file_path: book.file_path,
      book_id: req.params.id,
      cascade_duplicate_ids: dups.map(d => d.id),
      cascade_duplicate_paths: dups.map(d => d.file_path),
      user_id: req.user!.userId,
    });
    successResponse(res, result, '已删除');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});

function cleanBookTitle(raw: string): string {
  return raw
    .replace(/[《\u300a][^》\u300b]{0,40}[》\u300b]/g, (m) => m.slice(1, -1))  // 《xxx》 → xxx
    .replace(/作者[：:][^\s，,。]{0,30}/g, '')                                  // 作者：xxx
    .replace(/[(\uff08][^)\uff09]{0,30}[)\uff09]/g, '')                          // (xxx) （xxx）
    .replace(/[[\u3010][^\]\u3011]{0,30}[\]\u3011]/g, '')                        // [xxx] 【xxx】
    .replace(/[-_\s]*(完本|精校版?|全本|完整版|最新版|修订版|番外|特别版|典藏版)[-_\s]*/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || raw;
}

// POST /api/library/:id/cover-test — 直接测试封面抓取，不走 AI 流程
router.post('/:id/cover-test', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  const searchTitle = cleanBookTitle(book.title);
  console.log('[cover-test] bookId:', req.params.id, 'raw:', book.title, '→ search:', searchTitle);
  try {
    const coverUrl = await fetchAndSaveCover(searchTitle, req.params.id);
    console.log('[cover-test] 结果:', coverUrl);
    if (coverUrl) {
      db.prepare('UPDATE books SET cover_url = ? WHERE id = ?').run(coverUrl, req.params.id);
    }
    successResponse(res, { coverUrl, bookTitle: book.title, searchTitle });
  } catch (e) {
    console.error('[cover-test] 异常:', e);
    errorResponse(res, 500, 'INTERNAL_ERROR', String(e));
  }
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
    const cleanedTitle = cleanBookTitle(book.title);

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

    // 若书籍尚无封面，从豆瓣下载封面到本地
    if (!book.cover_url) {
      const coverTitle = (info.title as string | undefined) || cleanedTitle;
      const coverUrl = await fetchAndSaveCover(coverTitle, req.params.id).catch((e) => {
        console.error('[ai-fill] 封面获取失败:', e);
        return undefined;
      });
      if (coverUrl) { updates.push('cover_url = ?'); values.push(coverUrl); }
    }

    if (updates.length > 0) {
      values.push(req.params.id);
      db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    // Persist AI metadata if AI returned any recommended_tags / similar_works
    const meta = extractMetadataFromAiResponse(infoRaw);
    if (meta.tags.length > 0 || meta.similar.length > 0) {
      const pluginName = (db.prepare("SELECT value FROM settings WHERE key = 'ai_plugin'").get() as { value?: string } | undefined)?.value;
      saveMetadata({
        book_id: req.params.id,
        recommended_tags: meta.tags,
        similar_works: meta.similar,
        generated_by: pluginName,
      });
    }

    const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book;
    successResponse(res, updated, 'AI 信息填充成功');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', 'AI 填充失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

// GET /api/library/:id/ai-metadata — recommended tags + similar works
router.get('/:id/ai-metadata', authMiddleware, (req: Request, res: Response) => {
  const meta = getMetadata(req.params.id);
  successResponse(res, meta);
});

// POST /api/library/lookup-by-titles — bulk title→bookId resolution
// Body: { titles: [{title, author?}] }  → returns same array with book_id added
// where found in the library. Matching is normalized (volume/episode suffixes,
// brackets, width, case stripped) so an AI-suggested base title like "盗墓笔记"
// links to an in-library numbered volume. See matchTitlesToBooks for ranking.
const lookupSchema = z.object({
  titles: z.array(z.object({ title: z.string().min(1), author: z.string().optional() })).max(50),
});
router.post('/lookup-by-titles', authMiddleware, (req: Request, res: Response) => {
  const parsed = lookupSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  const books = db.prepare(
    `SELECT id, title, author, chapter_count FROM books
     WHERE status IN ('normal','encoding_fixed')
       AND (duplicate_of IS NULL OR duplicate_of = '')`
  ).all() as LibraryBookForLookup[];
  const result = matchTitlesToBooks(parsed.data.titles, books);
  successResponse(res, result);
});

// POST /api/library/:id/normalize-chapters — AI-unify chapter titles
router.post('/:id/normalize-chapters', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }

  try {
    const { getReaderPlugin } = await import('../plugins/plugin-manager');
    const plugin = await getReaderPlugin(book);
    const chapters = await plugin.getChapters();
    const titles = chapters.map(c => c.title);
    const { normalizeChaptersForBook } = await import('../services/chapter-normalize');
    const result = await normalizeChaptersForBook(req.params.id, titles);
    successResponse(res, result, `已统一 ${result.normalized}/${result.total} 个章节标题`);
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});

// DELETE /api/library/:id/normalize-chapters — restore original titles
router.delete('/:id/normalize-chapters', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const { clearOverrides } = await import('../services/chapter-normalize');
  const cleared = clearOverrides(req.params.id);
  successResponse(res, { cleared }, `已恢复 ${cleared} 个章节的原标题`);
});

// GET /api/library/:id/normalize-chapters — current override count
router.get('/:id/normalize-chapters', authMiddleware, async (req: Request, res: Response) => {
  const { getOverrideCount } = await import('../services/chapter-normalize');
  successResponse(res, { count: getOverrideCount(req.params.id) });
});

export default router;
