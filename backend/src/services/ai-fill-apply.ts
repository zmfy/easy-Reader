import { getDb } from '../db';
import { Book } from '../types';
import { renderDefaultCoverSvg } from '../utils/default-cover';
import {
  downloadCoverFromPic, fetchRating, isAllowedDoubanImageUrl, isAllowedDoubanSubjectUrl, saveCoverFile,
} from '../utils/cover';
import { replaceMetadata } from './book-ai-metadata';
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
  cover: CoverChoice;
  /** 选中豆瓣封面时为该候选的书目页，否则为第一个候选的；用于在书没有评分时抓取评分 */
  ratingSubjectUrl?: string;
  /** 默认封面上印的书名（预览返回的 coverTitle）；未提供时用清洗后的书名 */
  coverTitle?: string;
  /** 预览返回的 AI 建议原样回传，用于区分「接受 AI 结果」与「手动修改」 */
  suggested: { author?: string; summary?: string; category?: string };
}

export class AiFillApplyError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const LOCKABLE: LockableField[] = ['author', 'summary', 'category'];

async function resolveCover(book: Book, input: AiFillApplyInput): Promise<string | undefined> {
  const cover = input.cover;
  if (cover.type === 'keep') return undefined;
  if (cover.type === 'douban') {
    if (!isAllowedDoubanImageUrl(cover.pic)) throw new AiFillApplyError('封面地址无效', 422);
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

  for (const field of LOCKABLE) {
    const value = input[field];
    if (value === undefined) continue;
    const current = (book[field] as string | null | undefined) ?? '';
    const suggestion = input.suggested[field];
    if (suggestion && value === suggestion) {
      // 接受 AI 结果：内容已是 AI 的，解除锁定
      if (value !== current) { updates.push(`${field} = ?`); values.push(value); }
      toUnlock.push(field);
    } else if (value !== current) {
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
    replaceMetadata(bookId, input.recommended_tags, input.similar_works, generatedBy);
    db.prepare("UPDATE books SET ai_fill_status = 'filled' WHERE id = ?").run(bookId);
    stampFillVersion(db, bookId);
  })();

  return db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book;
}
