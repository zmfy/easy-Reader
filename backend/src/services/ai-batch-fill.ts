import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { setScanProgress } from './scan-task';
import { writeAudit } from './audit-log';
import { fetchAndSaveCover } from '../utils/cover';
import { saveMetadata, extractMetadataFromAiResponse } from './book-ai-metadata';
import { AI_FILL_VERSION } from './scan-versions';
import { lookupKey } from './title-lookup';
import { extractAuthorFromName } from '../utils/title-normalizer';
import { authorsMatch } from '../utils/author-match';

const DEFAULT_CONCURRENCY = 2;
const RETRIES = 3;
const RETRY_BACKOFF_MS = 1500;
const RATE_LIMIT_BACKOFF_MS = 5000;

/** Rate-limit / transient errors that should be retried, not permanently failed. */
export function isRateLimitError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return m.includes('429') || m.includes('rate_limit') || m.includes('rate limit') || m.includes('too many requests');
}

export interface BatchFillInput {
  taskId?: string;
  user_id?: string;          // for audit attribution; defaults to 'system-scan'
  books: Array<{ id: string; file_path: string; file_format: string; title: string; author?: string }>;
}

export interface BatchFillResult {
  succeeded: string[];
  failed: Array<{ book_id: string; file_path: string; error: string }>;
  covers_fetched: number;
}

export interface FillCandidate { id: string; file_path: string; file_format: string; title: string; author?: string; }

/**
 * Books eligible for AI fill. Normal mode: missing author/summary AND not yet
 * attempted at the current AI_FILL_VERSION. Force: every normal non-duplicate
 * book regardless of version/fields (manually-edited fields stay protected
 * inside batchFill).
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
       AND ((author IS NULL OR author = '') OR (summary IS NULL OR summary = ''))
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

  if (input.taskId) {
    setScanProgress(input.taskId, { total_files: total, processed_files: 0 });
  }

  await Promise.all(input.books.map(b => limit(async () => {
    let transientFail = false;
    try {
      const rawText = readPreview(b.file_path, b.file_format);
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

      if (fillStatus === 'failed') {
        db.prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id);
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'author mismatch (AI 查到的作者与文件名作者不一致)' });
        return; // skip field writes; finally still stamps version (permanent failure)
      }

      const current = db.prepare('SELECT title, author, summary, category, cover_url, manually_edited_fields FROM books WHERE id = ?').get(b.id) as
        | { title?: string; author?: string; summary?: string; category?: string; cover_url?: string; manually_edited_fields?: string }
        | undefined;
      if (!current) {
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'book not found' });
        return;
      }
      const edited = new Set<string>(parseEditedFields(current.manually_edited_fields));

      const updates: string[] = [];
      const values: unknown[] = [];
      const filledFields: Record<string, string> = {};
      function maybeSet(field: 'title' | 'author' | 'summary' | 'category', newVal: string | undefined): void {
        if (!newVal) return;
        if (edited.has(field)) return;
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

      // Save metadata (recommended_tags, similar_works) if AI returned any.
      const meta = extractMetadataFromAiResponse(info as Record<string, unknown>);
      if (meta.tags.length > 0 || meta.similar.length > 0) {
        const pluginName = (db.prepare("SELECT value FROM settings WHERE key = 'ai_plugin'").get() as { value?: string } | undefined)?.value;
        saveMetadata({
          book_id: b.id,
          recommended_tags: meta.tags,
          similar_works: meta.similar,
          generated_by: pluginName,
        });
      }

      // Cover fetch: only when no existing cover + we have a title to search with.
      const titleForCover = ((info.title && info.title.trim()) || knownTitle || filledFields.title || current.title || '').trim();
      if (!current.cover_url && titleForCover.length > 0) {
        try {
          const coverUrl = await fetchAndSaveCover(titleForCover, b.id);
          if (coverUrl) {
            result.covers_fetched++;
            writeAudit({
              user_id: userId,
              action: 'ai_fetch_cover',
              resource_id: b.id,
              file_path: b.file_path,
              details: { cover_url: coverUrl, title_used: titleForCover },
            });
          }
        } catch {
          // cover fetch is best-effort; don't fail the book
        }
      }

      db.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = ?").run(b.id);
      result.succeeded.push(b.id);
    } catch (err) {
      if (isRateLimitError(err)) {
        transientFail = true;
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: '限流(429)，将在下次填充重试' });
        // do NOT set ai_fill_status, do NOT stamp version → left as 未尝试, re-queued next run
      } else {
        db.prepare("UPDATE books SET ai_fill_status = 'failed' WHERE id = ?").run(b.id);
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: (err as Error).message });
      }
    } finally {
      // Stamp on permanent failures/success: avoids re-queuing persistently unfillable books
      // every scan. Rate-limit (transient) failures are NOT stamped so the next normal run
      // picks them up automatically. Use force=true to re-fill after a provider outage.
      if (!transientFail) stampFillVersion(db, b.id);
      done++;
      if (input.taskId && (done % 2 === 0 || done === total)) {
        setScanProgress(input.taskId, { processed_files: done });
      }
    }
  })));

  return result;
}

function readPreview(filePath: string, format: string): string {
  if (format !== 'txt') return '';
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.slice(0, 2000);
  } catch {
    return '';
  }
}

function parseEditedFields(raw?: string): string[] {
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
