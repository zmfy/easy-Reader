import path from 'path';
import pLimit from 'p-limit';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { setScanProgress, isCancelled } from './scan-task';
import { writeAudit } from './audit-log';
import { doubanSuggest, downloadCover, fetchRating } from '../utils/cover';
import { extractMetadataFromAiResponse, getMetadata } from './book-ai-metadata';
import { AI_FILL_VERSION } from './scan-versions';
import { lookupKey } from './title-lookup';
import { extractAuthorFromName } from '../utils/title-normalizer';
import { authorsMatch } from '../utils/author-match';
import { buildBookEvidence } from './book-evidence';
import { detectContentMismatch, fieldConfidence } from '../ai/fill-prompt';
import { findAdaptations } from './adaptations';
import { recordContentMismatch, saveSuggestion, SuggestionData, SUGGEST_FIELDS } from './ai-suggestions';
import { getCategoryTree, resolveCategoryPath } from '../utils/category-tree';

const DEFAULT_CONCURRENCY = 2;
const RETRIES = 3;
const RETRY_BACKOFF_MS = 1500;
const RATE_LIMIT_BACKOFF_MS = 5000;
/** 每填充这么多本书生成一批「待确认」并通知管理员 */
export const FILL_BATCH_SIZE = 500;
/** 连续这么多本临时失败（限流）或出错时暂停任务，避免把整个书库刷成「失败」 */
export const MAX_CONSECUTIVE_FAILURES = 10;

/** Rate-limit / transient errors that should be retried, not permanently failed. */
export function isRateLimitError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes('429') || m.includes('rate_limit') || m.includes('rate limit') || m.includes('too many requests');
}

/**
 * AI 额度 / 余额用完：继续调用只会全部失败，应暂停整个任务。
 * DeepSeek 402；MiniMax 1008（余额不足）/ 2056（套餐用量超限）；其他厂商看报错文字。
 */
export function isQuotaError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b402\b/.test(m)
    || /"?status_code"?\s*[:=]\s*"?(1008|2056)\b/.test(m)
    || /insufficient|balance|quota|usage limit|exceeded your|余额|额度|用量/.test(m);
}

/** 密钥无效 / 无权限：每本都会失败，应暂停 */
export function isAuthError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /api error: (401|403)\b/i.test(m) || /invalid api key|unauthorized|authorized_error/i.test(m);
}

function briefError(err: unknown): string {
  const m = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
  return m.length > 100 ? `${m.slice(0, 100)}…` : m;
}

export interface FillBatchSummary {
  batch_no: number;
  /** 本批处理的书数 */
  processed: number;
  /** 有字段被自动写入的书数 */
  auto_filled: number;
  /** 留下待确认建议的书数 */
  suggested: number;
  failed: number;
}

export interface BatchFillInput {
  taskId?: string;
  user_id?: string;          // for audit attribution; defaults to 'system-scan'
  books: Array<{ id: string; file_path: string; file_format: string; title: string; author?: string }>;
  /** 每批本数，默认 FILL_BATCH_SIZE（测试可调小） */
  batchSize?: number;
  /** 每满一批（以及最后不满一批）时回调，用于发通知 */
  onBatchDone?: (summary: FillBatchSummary) => void;
}

export interface FillPause {
  reason: 'quota' | 'auth' | 'rate_limit' | 'errors';
  message: string;
}

export interface BatchFillResult {
  succeeded: string[];
  failed: Array<{ book_id: string; file_path: string; error: string }>;
  covers_fetched: number;
  /** 因额度用完 / 连续失败而提前停止；未处理的书没有盖版本戳，下次填充自动接着处理 */
  paused?: FillPause;
}

/** 分配下一个填充批次号（全局递增，存于 settings.ai_fill_batch_seq） */
export function nextFillBatchNo(db: Database.Database): number {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'ai_fill_batch_seq'").get() as { value?: string } | undefined;
  const next = (parseInt(row?.value ?? '0') || 0) + 1;
  db.prepare("INSERT INTO settings (key, value) VALUES ('ai_fill_batch_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(String(next));
  return next;
}

export interface FillCandidate { id: string; file_path: string; file_format: string; title: string; author?: string; }

/**
 * Books eligible for AI fill. Normal mode: any normal non-duplicate book not yet
 * filled at the current AI_FILL_VERSION (version-driven; fields irrelevant, so
 * resetting the version stamp re-queues a book). Force: every normal non-duplicate
 * book regardless of version. Manually-edited fields stay protected inside batchFill.
 */
export function selectFillCandidates(db: Database.Database, force: boolean): FillCandidate[] {
  if (force) {
    return db.prepare(
      `SELECT id, file_path, file_format, title, author FROM books
       WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')`
    ).all() as FillCandidate[];
  }
  return db.prepare(
    `SELECT id, file_path, file_format, title, author FROM books
     WHERE status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')
       AND (ai_fill_version IS NULL OR ai_fill_version < ?)`
  ).all(AI_FILL_VERSION) as FillCandidate[];
}

/** 给定已知作者与 Pass B 返回的作者，判定 filled/failed。 */
export function authorMatchDecision(knownAuthor: string, aiAuthor: string): 'filled' | 'failed' {
  if (!knownAuthor) return 'filled';
  if (!aiAuthor || !aiAuthor.trim()) return 'filled';
  return authorsMatch(aiAuthor, knownAuthor) ? 'filled' : 'failed';
}

export function stampFillVersion(db: Database.Database, bookId: string): void {
  db.prepare('UPDATE books SET ai_fill_version = ? WHERE id = ?').run(AI_FILL_VERSION, bookId);
}

/** Clear AI-fill stamps on all books so the next AI-fill scan re-processes them. */
export function resetAllFills(db: Database.Database): number {
  const info = db.prepare(
    `UPDATE books SET ai_fill_version = NULL, ai_fill_status = NULL
     WHERE ai_fill_version IS NOT NULL OR ai_fill_status IS NOT NULL`
  ).run();
  return info.changes;
}

export async function batchFill(input: BatchFillInput): Promise<BatchFillResult> {
  const db = getDb();
  const concRow = db.prepare("SELECT value FROM settings WHERE key = 'ai_fill_concurrency'").get() as { value?: string } | undefined;
  const parsedConc = parseInt(concRow?.value ?? '');
  const concurrency = Number.isFinite(parsedConc) && parsedConc >= 1 && parsedConc <= 10 ? parsedConc : DEFAULT_CONCURRENCY;
  const limit = pLimit(concurrency);
  const result: BatchFillResult = { succeeded: [], failed: [], covers_fetched: 0 };
  let done = 0;
  const total = input.books.length;
  const userId = input.user_id ?? 'system-scan';
  const batchSize = input.batchSize ?? FILL_BATCH_SIZE;

  // 批次：用到时才分配批次号（避免空批占号）；每处理满 batchSize 本结算一次
  let batchNo: number | null = null;
  let batch = { processed: 0, auto_filled: 0, failed: 0 };
  const currentBatchNo = (): number => (batchNo ??= nextFillBatchNo(db));
  const closeBatch = (): void => {
    if (batch.processed === 0) return;
    const no = currentBatchNo();
    // 待确认数按批次号统计（并发时一本书的建议可能记在相邻批次），与待确认页一致
    const suggested = (db.prepare('SELECT COUNT(*) AS n FROM ai_suggestions WHERE batch_no = ?').get(no) as { n: number }).n;
    const summary = { batch_no: no, ...batch, suggested };
    batchNo = null;
    batch = { processed: 0, auto_filled: 0, failed: 0 };
    input.onBatchDone?.(summary);
  };

  // 熔断：额度用完立即停；连续失败达到上限也停，并撤销这一串失败标记（多半不是书的问题）
  let paused: FillPause | undefined;
  let transientStreak = 0;
  let errorStreak: string[] = [];
  const countInBatch = (processed: number, failed: number, autoFilled = 0): void => {
    batch.processed += processed;
    batch.failed += failed;
    batch.auto_filled += autoFilled;
    if (batch.processed >= batchSize) closeBatch();
  };
  const flushErrorStreak = (): void => {
    if (errorStreak.length > 0) countInBatch(errorStreak.length, errorStreak.length);
    errorStreak = [];
  };

  if (input.taskId) {
    setScanProgress(input.taskId, { total_files: total, processed_files: 0 });
  }

  await Promise.all(input.books.map(b => limit(async () => {
    // Bail before starting work if the scan/fill task was cancelled. pLimit means
    // most books are still queued when cancel fires, so they skip immediately;
    // only the ≤concurrency in-flight books finish.
    if (paused || (input.taskId && isCancelled(input.taskId))) return;
    let transientFail = false;
    let outcome: 'ok' | 'error' | 'transient' = 'ok';
    let autoFilled = false;   // 处理完才计入批次，避免并发时与本数记在不同批
    let authorMismatch = false;
    try {
      const rawText = (await buildBookEvidence(b)).text;
      const knownTitle = lookupKey(b.title) || b.title;
      const knownAuthor = ((b.author ?? '').trim()) || (extractAuthorFromName(path.basename(b.file_path)) ?? '');

      let info: Awaited<ReturnType<typeof aiManager.fillBookInfo>>;
      let fillStatus: 'filled' | 'failed' = 'filled';

      if (knownAuthor) {
        const passA = await callWithRetry(
          () => aiManager.fillBookInfo(rawText, db, { title: knownTitle, author: knownAuthor }),
          RETRIES,
        );
        const foundA = !!(passA.author && passA.author.trim()) || !!(passA.summary && passA.summary.trim());
        if (foundA) {
          info = passA;
        } else {
          const passB = await callWithRetry(() => aiManager.fillBookInfo(rawText, db, { title: knownTitle }), RETRIES);
          info = passB;
          fillStatus = authorMatchDecision(knownAuthor, passB.author ?? '');
        }
      } else {
        info = await callWithRetry(() => aiManager.fillBookInfo(rawText, db, { title: knownTitle }), RETRIES);
      }

      // 分类只接受分类树中的路径（末级名可唯一对应时自动补全），否则不写
      info.category = resolveCategoryPath(getCategoryTree(db), info.category);

      if (fillStatus === 'failed') {
        db.prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id);
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'author mismatch (AI 查到的作者与文件名作者不一致)' });
        authorMismatch = true;
        return; // skip field writes; finally still stamps version (permanent failure)
      }

      const current = db.prepare('SELECT title, author, summary, category, cover_url, rating, manually_edited_fields FROM books WHERE id = ?').get(b.id) as
        | { title?: string; author?: string; summary?: string; category?: string; cover_url?: string; rating?: number | null; manually_edited_fields?: string }
        | undefined;
      if (!current) {
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'book not found' });
        return;
      }
      const edited = new Set<string>(parseEditedFields(current.manually_edited_fields));

      // 正文与文件名不是同一本书时（错标），一个字段都不自动写，全部进待确认
      const mismatch = detectContentMismatch(info as Record<string, unknown>);
      recordContentMismatch(db, b.id, mismatch);

      const updates: string[] = [];
      const values: unknown[] = [];
      const filledFields: Record<string, string> = {};
      function maybeSet(field: 'title' | 'author' | 'summary' | 'category', newVal: string | undefined): void {
        if (!newVal || mismatch) return;
        if (edited.has(field)) return;
        // 只凭书名和模型知识得出的（低置信）不自动写入，进待确认由人决定
        if (fieldConfidence(info as Record<string, unknown>, field) === 'low') return;
        const cur = current![field];
        if (cur && cur.trim().length > 0) return;
        updates.push(`${field} = ?`);
        values.push(newVal);
        filledFields[field] = newVal.length > 60 ? newVal.slice(0, 60) + '…' : newVal;
      }
      maybeSet('title', info.title);
      maybeSet('author', info.author);
      maybeSet('summary', info.summary);
      maybeSet('category', info.category);

      if (updates.length > 0) {
        autoFilled = true;
        values.push(b.id);
        db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        writeAudit({
          user_id: userId,
          action: 'ai_fill_book',
          resource_id: b.id,
          file_path: b.file_path,
          details: { filled: filledFields },
        });
      }

      // 其余结果进「待确认」：与当前不同、且没有自动写入的字段，以及标签、类似作品、改编作品
      const infoRec = info as Record<string, unknown>;
      const evidence = infoRec.evidence && typeof infoRec.evidence === 'object' ? infoRec.evidence as Record<string, unknown> : {};
      const suggestion: SuggestionData = { fields: {} };
      for (const f of SUGGEST_FIELDS) {
        const value = typeof info[f] === 'string' ? (info[f] as string).trim() : '';
        if (!value || filledFields[f] !== undefined) continue;
        const cur = (current[f] ?? '').trim();
        if (cur === value) continue;
        const note = typeof evidence[f] === 'string' ? (evidence[f] as string).trim().slice(0, 200) : '';
        suggestion.fields[f] = {
          value, current: cur || null, confidence: fieldConfidence(infoRec, f),
          ...(note ? { evidence: note } : {}), ...(edited.has(f) ? { locked: true } : {}),
        };
      }
      const meta = extractMetadataFromAiResponse(infoRec);
      const existing = getMetadata(b.id);
      if (meta.tags.length > 0 && !sameList(meta.tags, existing?.recommended_tags ?? [])) suggestion.recommended_tags = meta.tags;
      if (meta.similar.length > 0 && !sameList(meta.similar.map(w => w.title), (existing?.similar_works ?? []).map(w => w.title))) {
        suggestion.similar_works = meta.similar;
      }
      // 错标时按正文实际的书名查改编作品，而不是文件名上的
      const lookupTitle = (mismatch?.title || (info.title && info.title.trim()) || knownTitle || '').trim();
      const adaptations = await findAdaptations(
        { title: lookupTitle, author: mismatch?.author || info.author || current.author || undefined, summary: info.summary || current.summary || undefined },
        db, { throttle: true },
      ).catch(() => []);
      if (adaptations.length > 0 && !sameList(adaptations.map(a => a.url), (existing?.adaptations ?? []).map(a => a.url))) {
        suggestion.adaptations = adaptations.map(({ pic: _pic, ...a }) => a);
      }
      saveSuggestion(db, b.id, suggestion, currentBatchNo());

      // Cover + rating from douban: one suggest request shared by both, best-effort.
      const titleForCover = ((info.title && info.title.trim()) || knownTitle || filledFields.title || current.title || '').trim();
      const needCover = !current.cover_url;
      const needRating = current.rating == null;
      if ((needCover || needRating) && titleForCover.length > 0) {
        try {
          const item = await doubanSuggest(titleForCover);
          if (item) {
            if (needCover) {
              const coverUrl = await downloadCover(item, b.id);
              if (coverUrl) {
                db.prepare('UPDATE books SET cover_url = ? WHERE id = ?').run(coverUrl, b.id);
                result.covers_fetched++;
                writeAudit({
                  user_id: userId,
                  action: 'ai_fetch_cover',
                  resource_id: b.id,
                  file_path: b.file_path,
                  details: { cover_url: coverUrl, title_used: titleForCover },
                });
              }
            }
            if (needRating) {
              const rating = await fetchRating(item);
              if (rating != null) db.prepare('UPDATE books SET rating = ? WHERE id = ?').run(rating, b.id);
            }
          }
        } catch {
          // best-effort; never fail the book on cover/rating
        }
      }

      db.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = ?").run(b.id);
      result.succeeded.push(b.id);
    } catch (err) {
      const quota = isQuotaError(err);
      if (quota || isAuthError(err)) {
        // 额度用完 / 密钥无效：这本不算失败、不盖戳，整个任务暂停，恢复后再次填充即从这里继续
        transientFail = true;
        outcome = 'transient';
        paused ??= quota
          ? { reason: 'quota', message: `AI 额度已用完（${briefError(err)}）` }
          : { reason: 'auth', message: `AI 密钥无效或无权限（${briefError(err)}）` };
      } else if (isRateLimitError(err)) {
        transientFail = true;
        outcome = 'transient';
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: '限流(429)，将在下次填充重试' });
        // do NOT set ai_fill_status, do NOT stamp version → left as 未尝试, re-queued next run
      } else {
        outcome = 'error';
        db.prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id);
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: (err as Error).message });
      }
    } finally {
      // Stamp on permanent failures/success: avoids re-queuing persistently unfillable books
      // every scan. Rate-limit / quota (transient) failures are NOT stamped so the next normal
      // run picks them up automatically.
      if (!transientFail) stampFillVersion(db, b.id);
      if (outcome === 'ok') {
        transientStreak = 0;
        flushErrorStreak();
        countInBatch(1, authorMismatch ? 1 : 0, autoFilled ? 1 : 0);
      } else if (outcome === 'transient') {
        if (++transientStreak >= MAX_CONSECUTIVE_FAILURES) {
          paused ??= { reason: 'rate_limit', message: `连续 ${MAX_CONSECUTIVE_FAILURES} 本被 AI 服务限流` };
        }
      } else {
        // 出错的书先不计入批次：若接着连续出错触发熔断会被撤销
        errorStreak.push(b.id);
        if (errorStreak.length >= MAX_CONSECUTIVE_FAILURES && !paused) {
          const lastError = result.failed[result.failed.length - 1]?.error ?? '';
          paused = { reason: 'errors', message: `连续 ${MAX_CONSECUTIVE_FAILURES} 本填充出错（${briefError(lastError)}）` };
          // 多半是 AI 服务本身的问题而不是书的问题：撤销这一串失败标记，下次填充重新处理
          const undo = db.prepare('UPDATE books SET ai_fill_status = NULL, ai_fill_version = NULL WHERE id = ?');
          for (const id of errorStreak) undo.run(id);
          const undone = new Set(errorStreak);
          result.failed = result.failed.filter(f => !undone.has(f.book_id));
          errorStreak = [];
        }
      }
      done++;
      if (input.taskId && (done % 2 === 0 || done === total)) {
        setScanProgress(input.taskId, { processed_files: done });
      }
    }
  })));

  flushErrorStreak();   // 没触发熔断的出错书照常计为失败
  closeBatch();
  if (paused) result.paused = paused;
  return result;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

export function parseEditedFields(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function callWithRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isQuotaError(err) || isAuthError(err)) break;   // 额度用完 / 密钥无效，重试也没用
      if (attempt < retries) {
        const delay = isRateLimitError(err)
          ? RATE_LIMIT_BACKOFF_MS * Math.pow(2, attempt)   // 5s, 10s, 20s…
          : RETRY_BACKOFF_MS * (attempt + 1);              // 1.5s, 3s, 4.5s…
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }
  throw lastErr;
}

/**
 * Append to manually_edited_fields when admin edits a field via PUT /library/:id.
 */
export function markFieldsAsEdited(bookId: string, fields: Array<'title' | 'author' | 'summary' | 'category'>): void {
  const db = getDb();
  const row = db.prepare('SELECT manually_edited_fields FROM books WHERE id = ?').get(bookId) as
    | { manually_edited_fields?: string }
    | undefined;
  const existing = new Set<string>(parseEditedFields(row?.manually_edited_fields));
  for (const f of fields) existing.add(f);
  db.prepare('UPDATE books SET manually_edited_fields = ? WHERE id = ?').run(JSON.stringify([...existing]), bookId);
}

/** Remove fields from manually_edited_fields (e.g. admin accepted the AI value for a locked field). */
export function unmarkFieldsAsEdited(bookId: string, fields: Array<'title' | 'author' | 'summary' | 'category'>): void {
  const db = getDb();
  const row = db.prepare('SELECT manually_edited_fields FROM books WHERE id = ?').get(bookId) as
    | { manually_edited_fields?: string }
    | undefined;
  const remaining = parseEditedFields(row?.manually_edited_fields).filter(f => !(fields as string[]).includes(f));
  db.prepare('UPDATE books SET manually_edited_fields = ? WHERE id = ?').run(JSON.stringify(remaining), bookId);
}
