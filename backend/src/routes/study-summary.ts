import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { Book } from '../types';
import { isAiConfigured } from '../ai/ai-manager';
import { getReaderPlugin } from '../plugins/plugin-manager';
import { resolveRealPathInsideRoot } from '../utils/path-safe';
import {
  getSummary, saveUserDoc, restoreVersion, listVersions, getVersion, deleteSummary, listSummaryOverview,
  collectNotes, newNotes, resolveRef, findRefNote, StudySummary,
} from '../services/study-summary';
import { startSummaryJob, getCurrentJob } from '../services/summary-job';
import { isValidDoc, docToBlocks, docToMarkdown, extractRefs } from '../services/summary-doc';

const router = Router();
const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';
const AI_NOT_CONFIGURED_MSG = '未配置 AI 插件，请先在「AI 插件设置」中配置';
const MAX_DOC_JSON = 2_000_000;

// 书的数据库记录（书已删除 → null）
function findBookRow(bookId: string): Book | null {
  return (getDb().prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book | undefined) || null;
}

// 可读取的书（记录存在且文件在书库内）；否则 null，不向客户端报错
function findReadableBookQuiet(bookId: string): Book | null {
  const book = findBookRow(bookId);
  if (!book) return null;
  const realPath = resolveRealPathInsideRoot(BOOKS_DIR, book.file_path);
  return realPath ? { ...book, file_path: realPath } : null;
}

// 章节标题表（index → title）；PDF 原生模式、读取失败一律返回空表，调用方用「第 N 章」
async function loadChapterTitles(book: Book): Promise<Map<number, string>> {
  const titles = new Map<number, string>();
  try {
    if (book.file_format.toLowerCase() === 'pdf') {
      const row = getDb().prepare("SELECT value FROM settings WHERE key = 'pdf_use_plugin'").get() as { value: string } | undefined;
      if (row?.value === 'false') return titles;
    }
    const plugin = await getReaderPlugin(book);
    const chapters = await plugin.getChapters();
    const { getOverridesMap } = await import('../services/chapter-normalize');
    const overrides = getOverridesMap(book.id);
    for (const c of chapters) titles.set(c.index, overrides.get(c.index) ?? c.title);
  } catch (err) {
    console.error(`[study:markdown] book=${book.id} 读取目录失败`, err);
  }
  return titles;
}

type SaveFail = { ok: false; reason: 'conflict' | 'busy' | 'not_found'; summary?: StudySummary };
function failSave(res: Response, userId: string, bookId: string, r: SaveFail): void {
  if (r.reason === 'not_found') { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '笔记整理或版本不存在'); return; }
  const msg = r.reason === 'busy' ? '正在整理中，请稍后再改' : '整理内容已在别处更新';
  // 409 的 data 为最新总结，客户端据此重新加载
  const latest = r.summary || getSummary(getDb(), userId, bookId);
  res.status(409).json({
    success: false, code: 'BUSINESS_CONFLICT', message: msg, data: latest,
    meta: { timestamp: new Date().toISOString() },
  });
}

// GET /api/study/summaries?q= — 有笔记或有总结的书的总览
router.get('/summaries', authMiddleware, (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : undefined;
  successResponse(res, listSummaryOverview(getDb(), req.user!.userId, q));
});

// GET /api/study/books/:bookId/summary?format=json|blocks|markdown
router.get('/books/:bookId/summary', authMiddleware, async (req: Request, res: Response) => {
  try {
    const format = req.query.format === undefined ? 'json' : req.query.format;
    if (format !== 'json' && format !== 'blocks' && format !== 'markdown') {
      errorResponse(res, 422, 'VALIDATION_ERROR', 'format 只能是 json、blocks 或 markdown'); return;
    }
    const db = getDb();
    const userId = req.user!.userId;
    const bookId = req.params.bookId;
    const bookRow = findBookRow(bookId);
    const bookTitle = bookRow ? bookRow.title : null;
    const summary = getSummary(db, userId, bookId);
    const notes = collectNotes(db, userId, bookId);

    let out: Record<string, unknown> | null = null;
    if (summary) {
      const { doc, ...rest } = summary;
      if (format === 'json') out = { ...rest, doc };
      else if (format === 'blocks') out = { ...rest, blocks: docToBlocks(doc) };
      else {
        const labels = new Map<string, string>();
        const refs = extractRefs(doc);
        const found = refs.map(r => ({ ref: r, note: findRefNote(db, userId, bookId, r) }));
        let titles = new Map<number, string>();
        // 每本书最多取一次目录：仅在有引用且书可读时
        if (found.some(f => f.note)) {
          const readable = findReadableBookQuiet(bookId);
          if (readable) titles = await loadChapterTitles(readable);
        }
        for (const f of found) {
          if (!f.note) { labels.set(f.ref, '原笔记已删除'); continue; }
          const title = titles.get(f.note.chapterIndex) || `第 ${f.note.chapterIndex + 1} 章`;
          labels.set(f.ref, bookTitle ? `${bookTitle} ${title}` : title);
        }
        out = { ...rest, markdown: docToMarkdown(bookTitle || '未知书籍', doc, ref => labels.get(ref) || '原笔记已删除') };
      }
    }
    successResponse(res, {
      summary: out, bookTitle, noteCount: notes.length, newNoteCount: newNotes(notes, summary).length,
      job: getCurrentJob(db, userId, bookId),
    });
  } catch (err) {
    console.error(`[study:summary] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '读取笔记整理失败');
  }
});

const revisionSchema = z.number().int().min(1);

// PUT /api/study/books/:bookId/summary — 手动保存（乐观并发：revision 须等于当前修订号）
router.put('/books/:bookId/summary', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({ doc: z.unknown(), revision: revisionSchema }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const { doc, revision } = parsed.data;
  if (!isValidDoc(doc)) { errorResponse(res, 422, 'VALIDATION_ERROR', '文档格式不正确'); return; }
  if (JSON.stringify(doc).length > MAX_DOC_JSON) { errorResponse(res, 422, 'VALIDATION_ERROR', '文档太大'); return; }
  const r = saveUserDoc(getDb(), req.user!.userId, req.params.bookId, doc, revision);
  if (!r.ok) { failSave(res, req.user!.userId, req.params.bookId, r); return; }
  successResponse(res, r.summary);
});

// DELETE /api/study/books/:bookId/summary
router.delete('/books/:bookId/summary', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const userId = req.user!.userId;
  if (deleteSummary(db, userId, req.params.bookId)) { successResponse(res, { deleted: true }); return; }
  if (!getSummary(db, userId, req.params.bookId)) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '笔记整理不存在'); return; }
  errorResponse(res, 409, 'BUSINESS_CONFLICT', '正在整理中，请稍后再删');
});

// POST /api/study/books/:bookId/summary/jobs — 启动后台任务（已在运行也返回 202 与该任务）
router.post('/books/:bookId/summary/jobs', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({ kind: z.enum(['generate', 'update']) }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const db = getDb();
  if (!isAiConfigured(db)) { errorResponse(res, 400, 'AI_NOT_CONFIGURED', AI_NOT_CONFIGURED_MSG); return; }
  const book = findBookRow(req.params.bookId);
  if (!book) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '书籍不存在'); return; }
  const r = startSummaryJob(db, req.user!.userId, book.id, book.title, parsed.data.kind);
  if ('error' in r) {
    const msg = r.error === 'no_notes' ? '这本书还没有笔记'
      : r.error === 'no_new_notes' ? '没有新笔记' : '已经整理过，请使用更新';
    errorResponse(res, 422, 'VALIDATION_ERROR', msg); return;
  }
  successResponse(res, r.job, '任务已启动', 202);
});

// GET /api/study/books/:bookId/summary/jobs/current — 最近一次任务（无 → null）
router.get('/books/:bookId/summary/jobs/current', authMiddleware, (req: Request, res: Response) => {
  successResponse(res, getCurrentJob(getDb(), req.user!.userId, req.params.bookId));
});

// GET /api/study/books/:bookId/summary/versions
router.get('/books/:bookId/summary/versions', authMiddleware, (req: Request, res: Response) => {
  successResponse(res, listVersions(getDb(), req.user!.userId, req.params.bookId));
});

// GET /api/study/books/:bookId/summary/versions/:versionId
router.get('/books/:bookId/summary/versions/:versionId', authMiddleware, (req: Request, res: Response) => {
  const v = getVersion(getDb(), req.user!.userId, req.params.bookId, req.params.versionId);
  if (!v) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '版本不存在'); return; }
  successResponse(res, v);
});

// POST /api/study/books/:bookId/summary/versions/:versionId/restore
router.post('/books/:bookId/summary/versions/:versionId/restore', authMiddleware, (req: Request, res: Response) => {
  const parsed = z.object({ revision: revisionSchema }).safeParse(req.body ?? {});
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }
  const r = restoreVersion(getDb(), req.user!.userId, req.params.bookId, req.params.versionId, parsed.data.revision);
  if (!r.ok) { failSave(res, req.user!.userId, req.params.bookId, r); return; }
  successResponse(res, r.summary);
});

// GET /api/study/books/:bookId/refs/:ref — 解析总结里的引用（h:划线id / n:节点id）
router.get('/books/:bookId/refs/:ref', authMiddleware, async (req: Request, res: Response) => {
  try {
    const book = findReadableBookQuiet(req.params.bookId);
    successResponse(res, await resolveRef(getDb(), req.user!.userId, req.params.bookId, book, req.params.ref));
  } catch (err) {
    console.error(`[study:ref] book=${req.params.bookId}`, err);
    errorResponse(res, 500, 'INTERNAL_ERROR', '解析引用失败');
  }
});

export default router;
