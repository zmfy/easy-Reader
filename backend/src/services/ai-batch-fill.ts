import fs from 'fs';
import pLimit from 'p-limit';
import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { setScanProgress } from './scan-task';

const CONCURRENCY = 3;
const RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

export interface BatchFillInput {
  taskId?: string;
  books: Array<{ id: string; file_path: string; file_format: string }>;
}

export interface BatchFillResult {
  succeeded: string[];
  failed: Array<{ book_id: string; file_path: string; error: string }>;
}

export async function batchFill(input: BatchFillInput): Promise<BatchFillResult> {
  const db = getDb();
  const limit = pLimit(CONCURRENCY);
  const result: BatchFillResult = { succeeded: [], failed: [] };
  let done = 0;
  const total = input.books.length;

  if (input.taskId) {
    setScanProgress(input.taskId, { total_files: total, processed_files: 0 });
  }

  await Promise.all(input.books.map(b => limit(async () => {
    try {
      const rawText = readPreview(b.file_path, b.file_format);
      const info = await callWithRetry(() => aiManager.fillBookInfo(rawText, db), RETRIES);

      const current = db.prepare('SELECT title, author, summary, category, manually_edited_fields FROM books WHERE id = ?').get(b.id) as
        | { title?: string; author?: string; summary?: string; category?: string; manually_edited_fields?: string }
        | undefined;
      if (!current) {
        result.failed.push({ book_id: b.id, file_path: b.file_path, error: 'book not found' });
        return;
      }
      const edited = new Set<string>(parseEditedFields(current.manually_edited_fields));

      const updates: string[] = [];
      const values: unknown[] = [];
      function maybeSet(field: 'title' | 'author' | 'summary' | 'category', newVal: string | undefined): void {
        if (!newVal) return;
        if (edited.has(field)) return;
        const cur = current![field];
        if (cur && cur.trim().length > 0) return;
        updates.push(`${field} = ?`);
        values.push(newVal);
      }
      maybeSet('title', info.title);
      maybeSet('author', info.author);
      maybeSet('summary', info.summary);
      maybeSet('category', info.category);

      if (updates.length > 0) {
        values.push(b.id);
        db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      }
      result.succeeded.push(b.id);
    } catch (err) {
      result.failed.push({ book_id: b.id, file_path: b.file_path, error: (err as Error).message });
    } finally {
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
        await new Promise(res => setTimeout(res, RETRY_BACKOFF_MS * (attempt + 1)));
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
