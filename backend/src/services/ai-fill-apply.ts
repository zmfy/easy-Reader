import { z } from 'zod';
import { getDb } from '../db';
import { Book } from '../types';
import { renderDefaultCoverSvg } from '../utils/default-cover';
import {
  downloadCoverFromPic, fetchRating, isAllowedCoverImageUrl, isAllowedDoubanSubjectUrl, saveCoverFile,
} from '../utils/cover';
import { replaceAdaptations, replaceMetadata } from './book-ai-metadata';
import { Adaptation, ADAPTATION_TYPES } from './adaptations';
import { isAllowedAdaptationUrl } from '../utils/adaptation-sources';
import { getCategoryTree, isValidCategoryPath } from '../utils/category-tree';
import { markCategoriesReviewed } from './category-migrate';
import { markFieldsAsEdited, stampFillVersion, unmarkFieldsAsEdited } from './ai-batch-fill';
import { BookNotFoundError, cleanBookTitle, LockableField, SimilarWork } from './ai-fill-preview';

/**
 * 应用用户在 AI 填充预览中确认的结果。
 * 先处理封面（校验 / 下载 / 生成），失败则抛错且不写任何字段；成功后在一个事务内写入。
 */

export type CoverChoice = { type: 'keep' } | { type: 'douban'; pic: string } | { type: 'default' };

export interface AiFillApplyInput {
  author?: string;
  summary?: string;
  category?: string;
  is_finished?: boolean;
  recommended_tags: string[];
  similar_works: SimilarWork[];
  /** 用户确认的改编作品；未提供时保留原有 */
  adaptations?: Adaptation[];
  cover: CoverChoice;
  /** 选中豆瓣封面时为该候选的书目页，否则为第一个候选的；用于在书没有评分时抓取评分 */
  ratingSubjectUrl?: string;
  /** 默认封面上印的书名（预览返回的 coverTitle）；未提供时用清洗后的书名 */
  coverTitle?: string;
  /** 预览返回的 AI 建议原样回传，用于区分「接受 AI 结果」与「手动修改」 */
  suggested: { author?: string; summary?: string; category?: string };
}

const adaptationSchema = z.object({
  type: z.enum(ADAPTATION_TYPES),
  title: z.string().trim().min(1).max(200),
  year: z.string().trim().max(10).optional(),
  source: z.enum(['douban', 'missevan']),
  url: z.string().max(300).refine(isAllowedAdaptationUrl),
});

const similarWorkSchema = z.object({
  title: z.string().trim().min(1).max(100),
  author: z.string().trim().max(100).optional(),
  reason: z.string().trim().max(500).optional(),
});

// 上限按「已有内容 / AI 结果可能达到的长度」放宽（导入的简介常超过 5000 字）
const aiFillApplySchema = z.object({
  author: z.string().trim().max(200).optional(),
  summary: z.string().trim().max(20000).optional(),
  category: z.string().trim().max(200).optional(),
  is_finished: z.boolean().optional(),
  recommended_tags: z.array(z.string().trim().min(1).max(30)).max(20),
  similar_works: z.array(similarWorkSchema).max(20),
  adaptations: z.array(adaptationSchema).max(30).optional(),
  cover: z.discriminatedUnion('type', [
    z.object({ type: z.literal('keep') }),
    z.object({ type: z.literal('douban'), pic: z.string().max(500) }),
    z.object({ type: z.literal('default') }),
  ]),
  ratingSubjectUrl: z.string().max(500).optional(),
  coverTitle: z.string().trim().max(200).optional(),
  suggested: z.object({
    author: z.string().optional(),
    summary: z.string().optional(),
    category: z.string().optional(),
  }),
});

const FIELD_LABELS: Record<string, string> = {
  author: '作者', summary: '简介', category: '分类', is_finished: '连载状态',
  recommended_tags: '推荐标签', similar_works: '类似作品', adaptations: '改编作品', cover: '封面', coverTitle: '封面书名',
};

/** 校验应用请求体；失败时给出具体字段，方便用户在预览中修改 */
export function parseAiFillApplyBody(body: unknown):
  { ok: true; data: AiFillApplyInput } | { ok: false; message: string } {
  const parsed = aiFillApplySchema.safeParse(body);
  if (parsed.success) return { ok: true, data: parsed.data };
  const field = String(parsed.error.issues[0]?.path[0] ?? '');
  const label = FIELD_LABELS[field];
  return { ok: false, message: label ? `「${label}」内容过长或格式不正确` : '参数校验失败' };
}

export class AiFillApplyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const LOCKABLE: LockableField[] = ['author', 'summary', 'category'];

async function resolveCover(book: Book, input: AiFillApplyInput): Promise<string | undefined> {
  const cover = input.cover;
  if (cover.type === 'keep') return undefined;
  if (cover.type === 'douban') {
    if (!isAllowedCoverImageUrl(cover.pic)) throw new AiFillApplyError('封面地址无效', 422);
    const url = await downloadCoverFromPic(cover.pic, book.id);
    if (!url) throw new AiFillApplyError('封面下载失败，请重试或选择其他封面', 502);
    return url;
  }
  const svg = renderDefaultCoverSvg({
    title: input.coverTitle?.trim() || cleanBookTitle(book.title),
    author: input.author ?? book.author,
    category: input.category ?? book.category,
  });
  return saveCoverFile(book.id, svg, 'svg');
}

export async function applyAiFill(bookId: string, input: AiFillApplyInput, generatedBy?: string): Promise<Book> {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book | undefined;
  if (!book) throw new BookNotFoundError();

  const coverUrl = await resolveCover(book, input);

  let rating: number | undefined;
  if (book.rating == null && input.ratingSubjectUrl && isAllowedDoubanSubjectUrl(input.ratingSubjectUrl)) {
    rating = await fetchRating({ url: input.ratingSubjectUrl }).catch(() => undefined);
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  const toLock: LockableField[] = [];
  const toUnlock: LockableField[] = [];

  // 分类改了就必须是分类树中的路径（保持原值不校验：旧书可能还是单级的旧分类）
  const newCategory = input.category?.trim();
  if (newCategory && newCategory !== (book.category ?? '').trim() && !isValidCategoryPath(getCategoryTree(db), newCategory)) {
    throw new AiFillApplyError('分类不在分类表中', 422);
  }

  for (const field of LOCKABLE) {
    const value = input[field];
    if (value === undefined) continue;
    // 只比较去掉首尾空白后的内容：现有值可能带换行（导入 / 手动保存），提交值经过 trim
    const current = ((book[field] as string | null | undefined) ?? '').trim();
    const suggestion = input.suggested[field]?.trim();
    if (suggestion && value.trim() === suggestion) {
      // 接受 AI 结果：内容已是 AI 的，解除锁定
      if (value.trim() !== current) { updates.push(`${field} = ?`); values.push(value); }
      toUnlock.push(field);
    } else if (value.trim() !== current) {
      // 手动修改：写入并锁定，避免之后被批量填充覆盖
      updates.push(`${field} = ?`); values.push(value);
      toLock.push(field);
    }
  }
  if (input.is_finished !== undefined) { updates.push('is_finished = ?'); values.push(input.is_finished ? 1 : 0); }
  if (coverUrl) { updates.push('cover_url = ?'); values.push(coverUrl); }
  if (rating !== undefined) { updates.push('rating = ?'); values.push(rating); }

  db.transaction(() => {
    if (updates.length > 0) db.prepare(`UPDATE books SET ${updates.join(', ')} WHERE id = ?`).run(...values, bookId);
    if (toLock.length > 0) markFieldsAsEdited(bookId, toLock);
    if (toUnlock.length > 0) unmarkFieldsAsEdited(bookId, toUnlock);
    if (newCategory !== undefined && newCategory !== (book.category ?? '').trim()) markCategoriesReviewed(db, [bookId]);
    // 已经在单本预览 / 待确认页处理过，这本书的后台建议作废
    db.prepare('DELETE FROM ai_suggestions WHERE book_id = ?').run(bookId);
    replaceMetadata(bookId, input.recommended_tags, input.similar_works, generatedBy);
    if (input.adaptations) replaceAdaptations(bookId, input.adaptations);
    // 审核过：之后批量填充跳过这本（单本书页仍可重新填充）
    db.prepare("UPDATE books SET ai_fill_status = 'filled', ai_reviewed_at = CURRENT_TIMESTAMP WHERE id = ?").run(bookId);
    stampFillVersion(db, bookId);
  })();

  return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book;
}
