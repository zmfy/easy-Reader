import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { Book } from '../types';
import { readTxtPreview } from '../plugins/parser-txt';
import { DoubanCandidate, doubanSuggestList, fetchCoverThumbnailDataUri } from '../utils/cover';
import { extractMetadataFromAiResponse, getMetadata } from './book-ai-metadata';
import { parseEditedFields } from './ai-batch-fill';
import { cleanBookTitle } from '../utils/book-title';

export { cleanBookTitle };

/**
 * 单本 AI 填充预览：只读，不写库、不落盘封面、不抓评分。
 * 用户在预览弹窗确认后由 ai-fill-apply 写入。
 */

export type LockableField = 'author' | 'summary' | 'category';
export type SimilarWork = { title: string; author?: string; reason?: string };

export interface AiFillPreview {
  current: {
    title: string; author: string | null; summary: string | null; category: string | null;
    is_finished: boolean | null; cover_url: string | null;
    recommended_tags: string[]; similar_works: SimilarWork[];
  };
  suggested: {
    author?: string; summary?: string; category?: string; is_finished?: boolean;
    recommended_tags: string[]; similar_works: SimilarWork[];
  };
  lockedFields: LockableField[];
  /** 默认封面上印的书名：AI 给出的书名，否则为清洗后的文件名书名（预览与保存一致） */
  coverTitle: string;
  coverCandidates: Array<DoubanCandidate & { thumbnail: string }>;
}

export class BookNotFoundError extends Error {
  constructor() { super('书籍不存在'); }
}

const LOCKABLE: LockableField[] = ['author', 'summary', 'category'];

const FINISHED_KEYWORDS = /完本|完结|全集|全本|完整版|精校版|完稿/;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function buildAiFillPreview(bookId: string): Promise<AiFillPreview> {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book | undefined;
  if (!book) throw new BookNotFoundError();

  const cleanedTitle = cleanBookTitle(book.title);
  const contentHint = book.file_format === 'txt' ? readTxtPreview(book.file_path, 600) : '';
  const lookupRequest = `书名：${cleanedTitle}\n原文件名（仅参考）：${book.title}\n文本节选（仅作辅助参考）：\n${contentHint}`;

  const info = await aiManager.fillBookInfo(lookupRequest, db) as Record<string, unknown>;

  // 完结：AI 优先，未给出时按文件名推断
  const isFinished = info.is_finished !== undefined ? !!info.is_finished : FINISHED_KEYWORDS.test(book.title);

  // 连载说明追加到简介（与原单本填充一致）
  let summary = str(info.summary);
  const startDate = str(info.start_date);
  if (summary && startDate) {
    const platform = str(info.platform);
    const endDate = str(info.end_date);
    const startPart = `从${startDate}开始${platform ? `在${platform}` : ''}连载`;
    summary += '\n' + (isFinished
      ? (endDate ? `${startPart}，于${endDate}完本。` : `${startPart}，已完本。`)
      : `${startPart}，目前还在连载中。`);
  }

  const meta = extractMetadataFromAiResponse(info);
  const current = getMetadata(bookId);

  // 豆瓣候选：用 AI 给出的书名检索；缩略图并发下载，失败的候选丢弃
  const candidates = await doubanSuggestList(str(info.title) || cleanedTitle);
  const thumbnails = await Promise.all(candidates.map(c => fetchCoverThumbnailDataUri(c.pic)));
  const coverCandidates = candidates.flatMap((c, i) => (thumbnails[i] ? [{ ...c, thumbnail: thumbnails[i]! }] : []));

  const edited = new Set(parseEditedFields(book.manually_edited_fields));

  return {
    current: {
      title: book.title,
      author: book.author ?? null,
      summary: book.summary ?? null,
      category: book.category ?? null,
      is_finished: book.is_finished === undefined || book.is_finished === null ? null : !!book.is_finished,
      cover_url: book.cover_url ?? null,
      recommended_tags: current?.recommended_tags ?? [],
      similar_works: current?.similar_works ?? [],
    },
    suggested: {
      ...(str(info.author) ? { author: str(info.author) } : {}),
      ...(summary ? { summary } : {}),
      ...(str(info.category) ? { category: str(info.category) } : {}),
      is_finished: isFinished,
      recommended_tags: meta.tags,
      similar_works: meta.similar,
    },
    lockedFields: LOCKABLE.filter(f => edited.has(f)),
    coverTitle: str(info.title) || cleanedTitle,
    coverCandidates,
  };
}
