import { Router, Request, Response } from 'express';
import { randomUUID as uuidv4 } from 'crypto';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, paginatedResponse, errorResponse } from '../utils/response';
import { Book, ScanOptions } from '../types';
import { isAiConfigured, getActivePluginName } from '../ai/ai-manager';
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
import { markFieldsAsEdited, resetAllFills } from '../services/ai-batch-fill';
import { runAiFill, getFillProgress, getLastFillTask } from '../services/ai-fill-task';
import { enqueueApplyJob, getApplyJob, listActiveApplyJobs } from '../services/ai-apply-job';
import { selectDuplicateGroupBooks } from '../services/duplicate-view';
import { estimateFromCurrentDb } from '../services/cost-estimator';
import { getMetadata } from '../services/book-ai-metadata';
import { matchTitlesToBooks, LibraryBookForLookup } from '../services/title-lookup';
import { buildAiFillPreview, BookNotFoundError, cleanBookTitle } from '../services/ai-fill-preview';
import { applyAiFill, AiFillApplyError, parseAiFillApplyBody } from '../services/ai-fill-apply';
import { renderDefaultCoverSvg } from '../utils/default-cover';
import { countMissingCovers, fillMissingDefaultCovers } from '../services/default-cover-file';
import { hideFilePathForNonAdmin, withDisplayTitle } from '../utils/book-view';
import {
  categoryFilterSql, countByCategoryPath, DEFAULT_CATEGORY_TREE, getCategoryTree, isValidCategoryPath,
} from '../utils/category-tree';
import { applyCategories, listLegacyCategoryBooks, markCategoriesReviewed, suggestLegacyCategories } from '../services/category-migrate';
import {
  acceptContentMismatch, applySuggestion, countSuggestions, dismissContentMismatch, dismissSuggestions, listSuggestions, listSuggestionBatches,
} from '../services/ai-suggestions';

const router = Router();

const ALLOWED_SORT_FIELDS = ['title', 'author', 'imported_at', 'file_size', 'category', 'rating'];
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
    paginatedResponse(res, withDisplayTitle(hideFilePathForNonAdmin(req, rows as unknown as Book[])), page, pageSize, total);
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

  // 错标：AI 判定正文与文件名不是同一本书、且没被「不是错标」忽略的（管理员筛选词「错标」）
  if (req.query.mismatch === '1') {
    whereClause += " AND content_mismatch IS NOT NULL AND COALESCE(json_extract(content_mismatch, '$.dismissed'), 0) = 0";
  }

  if (search) {
    whereClause += ' AND (title LIKE ? OR author LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    // 多级分类：选上级即包含全部下级
    const filter = categoryFilterSql(category);
    whereClause += ` AND ${filter.sql}`;
    params.push(...filter.params);
  }

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM books ${whereClause}`).get(...params) as { cnt: number }).cnt;
  const offset = (page - 1) * pageSize;
  // 书名按显示的清洗后书名排序（与 display_title 一致），同名再按原文件名
  const orderBy = sortBy === 'title'
    ? `clean_title(title) ${sortOrder}, title ${sortOrder}`
    : `${sortBy} ${sortOrder}`;
  const books = db.prepare(`SELECT * FROM books ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as Book[];

  paginatedResponse(res, withDisplayTitle(hideFilePathForNonAdmin(req, books)), page, pageSize, total);
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
  if (!isAiConfigured(getDb())) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', '未配置 AI 插件，请先在「AI 插件设置」中配置'); return; }
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
        await runAiFill(taskId, req.user!.userId, { force });
        finishScanTask(taskId, 'completed');   // 已暂停 / 已取消的任务不会被改回 completed
      } catch (e) {
        finishScanTask(taskId, 'failed', (e as Error).message);
      }
    })();
  });

  successResponse(res, { taskId, status: 'running' }, '批量填充任务已启动');
});

// GET /api/library/ai-fill-status — 全书库填充进度与最近一次填充任务（暂停时含原因）
router.get('/ai-fill-status', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, { ...getFillProgress(), no_cover: countMissingCovers(getDb()), last_task: getLastFillTask() });
});

// POST /api/library/default-covers — 给没有封面的书生成默认封面（本地生成，不调用 AI、不请求外网）
router.post('/default-covers', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, { generated: fillMissingDefaultCovers(getDb()) }, '已生成默认封面');
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

const defaultCoverSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
});

// GET /api/library/default-cover — 系统默认封面 SVG（AI 填充预览用；必须在 /:id 之前注册）
router.get('/default-cover', authMiddleware, (req: Request, res: Response) => {
  const parsed = defaultCoverSchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(renderDefaultCoverSvg(parsed.data));
});

// GET /api/library/categories — 分类树 + 各分类（含下级）书数，供书库筛选与编辑（必须在 /:id 之前注册）
router.get('/categories', authMiddleware, (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare(
    `SELECT category, COUNT(*) AS n FROM books
     WHERE status = 'normal' AND category IS NOT NULL AND TRIM(category) != ''
     GROUP BY category`
  ).all() as Array<{ category: string; n: number }>;
  successResponse(res, { tree: getCategoryTree(db), counts: countByCategoryPath(rows), defaultTree: DEFAULT_CATEGORY_TREE });
});

// GET /api/library/categories/legacy — 分类不在分类树中的书（设置页「整理」）
router.get('/categories/legacy', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, listLegacyCategoryBooks(getDb()));
});

// POST /api/library/categories/legacy/suggest — 给出新分类建议（映射表 + AI），不写库
router.post('/categories/legacy/suggest', authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  // 没配 AI 时 AI 那部分会失败并被忽略，仍返回映射表能对应的建议
  try {
    successResponse(res, await suggestLegacyCategories(getDb()));
  } catch (err) {
    console.error('[categories:suggest]', err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '生成分类建议失败');
  }
});

const applyCategoriesSchema = z.object({
  items: z.array(z.object({ book_id: z.string().min(1), category: z.string().min(1).max(200) })).min(1).max(1000),
});

// POST /api/library/categories/legacy/apply — 写入用户确认的分类
router.post('/categories/legacy/apply', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = applyCategoriesSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  try {
    successResponse(res, { updated: applyCategories(getDb(), parsed.data.items) });
  } catch (err) {
    errorResponse(res, 422, 'VALIDATION_ERROR', (err as Error).message);
  }
});

// GET /api/library/ai-suggestions — 后台 AI 丰富的待确认建议（必须在 /:id 之前注册）；?batch=N 只列该批
router.get('/ai-suggestions', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const raw = req.query.batch as string | undefined;
  let batchNo: number | null | undefined;
  if (raw === 'none') batchNo = null;
  else if (raw !== undefined && raw !== '') {
    batchNo = parseInt(raw);
    if (!Number.isInteger(batchNo) || batchNo < 1) { errorResponse(res, 422, 'VALIDATION_ERROR', '批次号不正确'); return; }
  }
  successResponse(res, listSuggestions(getDb(), batchNo));
});

// GET /api/library/ai-suggestions/batches — 各填充批次的待确认数量与进行中的后台采纳任务
router.get('/ai-suggestions/batches', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, { batches: listSuggestionBatches(getDb()), jobs: listActiveApplyJobs() });
});

// GET /api/library/ai-suggestions/count — 待确认数量（书库页提示条）
router.get('/ai-suggestions/count', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, { count: countSuggestions(getDb()) });
});

const applySuggestionsSchema = z.object({
  items: z.array(z.object({
    book_id: z.string().min(1),
    fields: z.array(z.enum(['title', 'author', 'summary', 'category'])).max(4),
    tags: z.boolean(),
    similar: z.boolean(),
    adaptations: z.boolean(),
  })).min(1).max(500),
});

// POST /api/library/ai-suggestions/apply — 逐本采纳勾选的建议；单本失败不影响其他
router.post('/ai-suggestions/apply', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const parsed = applySuggestionsSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const generatedBy = getActivePluginName(getDb()) ?? undefined;
  const applied: string[] = [];
  const failed: Array<{ book_id: string; error: string }> = [];
  for (const item of parsed.data.items) {
    try {
      await applySuggestion(item, req.user!.userId, generatedBy);
      applied.push(item.book_id);
    } catch (err) {
      failed.push({ book_id: item.book_id, error: (err as Error).message });
    }
  }
  successResponse(res, { applied, failed });
});

const applyJobSchema = z.object({
  batch_no: z.number().int().positive().nullable().default(null),
  items: applySuggestionsSchema.shape.items.element.array().min(1).max(1000),
});

// POST /api/library/ai-suggestions/apply-jobs — 大批量采纳交给后台排队执行，立即返回任务；完成后铃铛通知
router.post('/ai-suggestions/apply-jobs', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = applyJobSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  successResponse(res, enqueueApplyJob(parsed.data.items, req.user!.userId, parsed.data.batch_no), '已转为后台采纳');
});

// GET /api/library/ai-suggestions/apply-jobs/:id — 后台采纳进度
router.get('/ai-suggestions/apply-jobs/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const job = getApplyJob(req.params.id);
  if (!job) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '任务不存在'); return; }
  successResponse(res, job);
});

const bookIdsSchema = z.object({ book_ids: z.array(z.string().min(1)).min(1).max(1000) });

// POST /api/library/ai-suggestions/dismiss — 忽略建议（删除）
router.post('/ai-suggestions/dismiss', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = bookIdsSchema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  successResponse(res, { dismissed: dismissSuggestions(getDb(), parsed.data.book_ids) });
});

// GET /api/library/:id
router.get('/:id', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book | undefined;
  if (!book) {
    errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在');
    return;
  }
  successResponse(res, withDisplayTitle(hideFilePathForNonAdmin(req, book)));
});

const updateBookSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  author: z.string().max(100).optional(),
  cover_url: z.string().max(500).optional(),
  summary: z.string().max(5000).optional(),
  category: z.string().max(200).optional(),
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
  // 分类改了才校验：编辑表单会把未改动的旧分类（单级旧值）原样带回
  if (data.category && data.category !== book.category && !isValidCategoryPath(getCategoryTree(db), data.category)) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '分类不在分类表中');
    return;
  }
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
  if (data.category !== undefined && data.category !== book.category) markCategoriesReviewed(db, [req.params.id]);

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id) as Book;
  successResponse(res, withDisplayTitle(hideFilePathForNonAdmin(req, updated)), '更新成功');
});

const deleteQuerySchema = z.object({
  cascade_duplicates: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  confirm_shelf_impact: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
  // true = 仅删除书库记录，保留磁盘文件（下次扫描可能会重新导入）
  keep_file: z.union([z.string(), z.boolean()]).optional().transform(v => v === '1' || v === 'true' || v === true),
});

// DELETE /api/library/:id?cascade_duplicates=true&confirm_shelf_impact=true
//   - keep_file=true: only remove DB records, leave files on disk (default: delete files too)
//   - Validates path is inside BOOKS_DIR (path traversal protection)
//   - If book is a canonical with duplicates pointing to it → 409 unless cascade_duplicates=true
//   - If any of the books are on any user's shelf → 409 unless confirm_shelf_impact=true
//   - Deletes disk file(s) + DB rows in a transaction; writes audit_log entry
router.delete('/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const parsed = deleteQuerySchema.safeParse(req.query);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { cascade_duplicates, confirm_shelf_impact, keep_file } = parsed.data;

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
    }, { keepFiles: keep_file });
    successResponse(res, result, '已删除');
  } catch (err) {
    errorResponse(res, 500, 'INTERNAL_ERROR', (err as Error).message);
  }
});

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

// POST /api/library/:id/ai-fill/preview — AI 与豆瓣检索结果预览（只读，确认后由 apply 写入）
router.post('/:id/ai-fill/preview', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const db = getDb();
  if (!isAiConfigured(db)) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', '未配置 AI 插件，请先在「AI 插件设置」中配置'); return; }
  try {
    successResponse(res, await buildAiFillPreview(req.params.id));
  } catch (err) {
    if (err instanceof BookNotFoundError) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }
    errorResponse(res, 500, 'INTERNAL_ERROR', 'AI 填充失败: ' + (err instanceof Error ? err.message : '未知错误'));
  }
});

// POST /api/library/:id/ai-fill/apply — 写入用户在预览中确认的结果
router.post('/:id/ai-fill/apply', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const parsed = parseAiFillApplyBody(req.body);
  if (!parsed.ok) { errorResponse(res, 422, 'VALIDATION_ERROR', parsed.message); return; }
  try {
    const book = await applyAiFill(req.params.id, parsed.data, getActivePluginName(getDb()) ?? undefined);
    successResponse(res, book, 'AI 信息已应用');
  } catch (err) {
    if (err instanceof BookNotFoundError) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }
    if (err instanceof AiFillApplyError) {
      errorResponse(res, err.status, err.status === 422 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', err.message);
      return;
    }
    console.error(`[ai-fill:apply] book=${req.params.id}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '应用 AI 信息失败');
  }
});

// POST /api/library/:id/content-mismatch/accept — 认可错标判定：书名改为 AI 读到的正文书名，清除提示
router.post('/:id/content-mismatch/accept', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  if (!acceptContentMismatch(db, req.params.id)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '没有错标提示'); return; }
  successResponse(res, db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id), '书名已改为正文书名');
});

// POST /api/library/:id/content-mismatch/dismiss — 「不是错标」：之后同一判定不再提示
router.post('/:id/content-mismatch/dismiss', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  if (!dismissContentMismatch(getDb(), req.params.id)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '没有错标提示'); return; }
  successResponse(res, null, '已忽略');
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
