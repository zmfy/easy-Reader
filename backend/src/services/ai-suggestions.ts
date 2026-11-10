import Database from 'better-sqlite3';
import { getDb } from '../db';
import { Book } from '../types';
import { FillConfidence } from '../ai/fill-prompt';
import { Adaptation } from './adaptations';
import { getMetadata } from './book-ai-metadata';
import { applyAiFill, AiFillApplyInput } from './ai-fill-apply';
import { writeAudit } from './audit-log';

/**
 * 后台 AI 丰富的「待确认」建议：批量填充时，空字段 + 非低置信的结果直接写入，
 * 其余（改已有内容、低置信、锁定字段、标签、类似作品、改编作品）存成建议，
 * 由管理员在「待确认」页批量采纳或忽略。一本书只保留最新一条。
 */

export type SuggestField = 'author' | 'summary' | 'category';
export const SUGGEST_FIELDS: SuggestField[] = ['author', 'summary', 'category'];

export interface FieldSuggestion {
  value: string;
  current: string | null;
  confidence: FillConfidence;
  evidence?: string;
  /** 管理员手动改过的字段：建议默认不勾选 */
  locked?: boolean;
}

export type SimilarWork = { title: string; author?: string; reason?: string };

export interface SuggestionData {
  fields: Partial<Record<SuggestField, FieldSuggestion>>;
  recommended_tags?: string[];
  similar_works?: SimilarWork[];
  adaptations?: Adaptation[];
}

export interface ContentMismatch {
  title: string;
  author?: string;
  reason?: string;
  dismissed?: boolean;
}

export function isEmptySuggestion(d: SuggestionData): boolean {
  return Object.keys(d.fields).length === 0
    && !d.recommended_tags?.length && !d.similar_works?.length && !d.adaptations?.length;
}

/** 保存（覆盖）一本书的建议，记入填充批次；没有任何建议时删除旧的。返回是否留下了建议 */
export function saveSuggestion(db: Database.Database, bookId: string, data: SuggestionData, batchNo: number | null = null): boolean {
  if (isEmptySuggestion(data)) {
    deleteSuggestion(db, bookId);
    return false;
  }
  db.prepare(
    `INSERT INTO ai_suggestions (book_id, data, created_at, batch_no, apply_job_id) VALUES (?, ?, CURRENT_TIMESTAMP, ?, NULL)
     ON CONFLICT(book_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at,
       batch_no = excluded.batch_no, apply_job_id = NULL`
  ).run(bookId, JSON.stringify(data), batchNo);
  return true;
}

export function deleteSuggestion(db: Database.Database, bookId: string): void {
  db.prepare('DELETE FROM ai_suggestions WHERE book_id = ?').run(bookId);
}

export function countSuggestions(db: Database.Database): number {
  return (db.prepare(
    `SELECT COUNT(*) AS n FROM ai_suggestions s JOIN books b ON b.id = s.book_id
     WHERE b.status = 'normal' AND s.apply_job_id IS NULL`
  ).get() as { n: number }).n;
}

function parseMismatch(raw: string | null | undefined): ContentMismatch | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v.title === 'string' ? v as ContentMismatch : null;
  } catch {
    return null;
  }
}

/**
 * 记录 AI 的错标判定。没判定为不符时清除标记；用户已对同一书名点过「不是错标」的保持忽略。
 */
export function recordContentMismatch(
  db: Database.Database, bookId: string, detected: { title: string; author?: string; reason?: string } | undefined,
): void {
  const row = db.prepare('SELECT content_mismatch FROM books WHERE id = ?').get(bookId) as { content_mismatch?: string | null } | undefined;
  if (!row) return;
  const prev = parseMismatch(row.content_mismatch);
  let next: ContentMismatch | null = null;
  if (detected) next = prev?.dismissed && prev.title === detected.title ? { ...detected, dismissed: true } : detected;
  db.prepare('UPDATE books SET content_mismatch = ? WHERE id = ?').run(next ? JSON.stringify(next) : null, bookId);
}

export function dismissContentMismatch(db: Database.Database, bookId: string): boolean {
  const row = db.prepare('SELECT content_mismatch FROM books WHERE id = ?').get(bookId) as { content_mismatch?: string | null } | undefined;
  const prev = parseMismatch(row?.content_mismatch);
  if (!prev) return false;
  db.prepare('UPDATE books SET content_mismatch = ? WHERE id = ?').run(JSON.stringify({ ...prev, dismissed: true }), bookId);
  return true;
}

/** 未被忽略的错标判定（详情页、待确认页显示） */
export function activeContentMismatch(raw: string | null | undefined): ContentMismatch | null {
  const m = parseMismatch(raw);
  return m && !m.dismissed ? m : null;
}

export interface SuggestionView {
  book_id: string;
  title: string;
  author: string | null;
  cover_url: string | null;
  created_at: string;
  batch_no: number | null;
  content_mismatch: ContentMismatch | null;
  current: { recommended_tags: string[]; similar_works: SimilarWork[]; adaptations: Adaptation[] };
  data: SuggestionData;
}

export interface SuggestionBatch {
  batch_no: number | null;
  count: number;
  mismatch_count: number;
  /** 已交给后台采纳、还在处理中的本数 */
  applying: number;
}

/** 各填充批次的待确认数量（从早到晚） */
export function listSuggestionBatches(db: Database.Database): SuggestionBatch[] {
  const rows = db.prepare(
    `SELECT s.batch_no, s.apply_job_id, b.content_mismatch
     FROM ai_suggestions s JOIN books b ON b.id = s.book_id WHERE b.status = 'normal'`
  ).all() as Array<{ batch_no: number | null; apply_job_id: string | null; content_mismatch: string | null }>;
  const map = new Map<number | null, SuggestionBatch>();
  for (const r of rows) {
    let b = map.get(r.batch_no);
    if (!b) { b = { batch_no: r.batch_no, count: 0, mismatch_count: 0, applying: 0 }; map.set(r.batch_no, b); }
    if (r.apply_job_id) { b.applying++; continue; }
    b.count++;
    if (activeContentMismatch(r.content_mismatch)) b.mismatch_count++;
  }
  return [...map.values()].sort((a, b) => (a.batch_no ?? 0) - (b.batch_no ?? 0));
}

/** 待确认建议；给了批次号时只列该批。已交给后台采纳的不列出 */
export function listSuggestions(db: Database.Database, batchNo?: number | null): SuggestionView[] {
  const rows = db.prepare(
    `SELECT s.book_id, s.data, s.created_at, s.batch_no, b.title, b.author, b.cover_url, b.content_mismatch
     FROM ai_suggestions s JOIN books b ON b.id = s.book_id
     WHERE b.status = 'normal' AND s.apply_job_id IS NULL ${batchNo !== undefined ? 'AND s.batch_no IS ?' : ''}
     ORDER BY (b.content_mismatch IS NOT NULL) DESC, b.title`
  ).all(...(batchNo !== undefined ? [batchNo] : [])) as Array<{ book_id: string; data: string; created_at: string; batch_no: number | null; title: string; author: string | null; cover_url: string | null; content_mismatch: string | null }>;
  return rows.flatMap((r) => {
    let data: SuggestionData;
    try { data = JSON.parse(r.data); } catch { return []; }
    const meta = getMetadata(r.book_id);
    return [{
      book_id: r.book_id, title: r.title, author: r.author, cover_url: r.cover_url, created_at: r.created_at, batch_no: r.batch_no,
      content_mismatch: activeContentMismatch(r.content_mismatch),
      current: {
        recommended_tags: meta?.recommended_tags ?? [],
        similar_works: meta?.similar_works ?? [],
        adaptations: (meta?.adaptations ?? []) as Adaptation[],
      },
      data,
    }];
  });
}

export interface SuggestionSelection {
  book_id: string;
  fields: SuggestField[];
  tags: boolean;
  similar: boolean;
  adaptations: boolean;
}

export class SuggestionNotFoundError extends Error {
  constructor() { super('建议不存在或已处理'); }
}

/**
 * 采纳一本书的建议：把勾选项拼成 AI 填充的应用请求，交给 applyAiFill
 * （采纳 AI 值会解除锁定、分类必须是分类树路径、写版本戳等都沿用单本应用的规则）。
 */
export async function applySuggestion(sel: SuggestionSelection, userId: string, generatedBy?: string): Promise<Book> {
  const db = getDb();
  const row = db.prepare('SELECT data FROM ai_suggestions WHERE book_id = ?').get(sel.book_id) as { data?: string } | undefined;
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(sel.book_id) as Book | undefined;
  if (!row?.data || !book) throw new SuggestionNotFoundError();
  const data = JSON.parse(row.data) as SuggestionData;
  const meta = getMetadata(sel.book_id);

  const pick = (f: SuggestField): string | undefined => {
    const s = data.fields[f];
    return sel.fields.includes(f) && s ? s.value : undefined;
  };
  const applied: string[] = [];
  const input = {
    ...Object.fromEntries(SUGGEST_FIELDS.map((f) => {
      const v = pick(f);
      if (v !== undefined) applied.push(f);
      return [f, v ?? ((book[f] as string | undefined) ?? '')];
    })),
    recommended_tags: sel.tags && data.recommended_tags ? (applied.push('recommended_tags'), data.recommended_tags) : (meta?.recommended_tags ?? []),
    similar_works: sel.similar && data.similar_works ? (applied.push('similar_works'), data.similar_works) : (meta?.similar_works ?? []),
    ...(sel.adaptations && data.adaptations ? (applied.push('adaptations'), { adaptations: data.adaptations }) : {}),
    cover: { type: 'keep' as const },
    suggested: Object.fromEntries(SUGGEST_FIELDS.map(f => [f, pick(f)])),
  } as AiFillApplyInput;

  const updated = await applyAiFill(sel.book_id, input, generatedBy);
  deleteSuggestion(db, sel.book_id);
  writeAudit({
    user_id: userId,
    action: 'ai_suggestion_apply',
    resource_id: sel.book_id,
    file_path: book.file_path,
    details: { applied },
  });
  return updated;
}

/** 忽略建议；忽略也算审核过，之后批量填充跳过这些书 */
export function dismissSuggestions(db: Database.Database, bookIds: string[]): number {
  if (bookIds.length === 0) return 0;
  const marks = bookIds.map(() => '?').join(',');
  return db.transaction(() => {
    db.prepare(
      `UPDATE books SET ai_reviewed_at = CURRENT_TIMESTAMP WHERE id IN (SELECT book_id FROM ai_suggestions WHERE book_id IN (${marks}))`
    ).run(...bookIds);
    return db.prepare(`DELETE FROM ai_suggestions WHERE book_id IN (${marks})`).run(...bookIds).changes;
  })();
}
