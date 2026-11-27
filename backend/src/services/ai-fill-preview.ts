import path from 'path';
import Database from 'better-sqlite3';
import { getDb } from '../db';
import { aiManager } from '../ai/ai-manager';
import { Book } from '../types';
import { buildBookEvidence } from './book-evidence';
import { embeddedCoverDataUri } from './embedded-cover';
import { FillConfidence, detectContentMismatch, fieldConfidence } from '../ai/fill-prompt';
import { DoubanCandidate, fetchCoverThumbnailDataUri } from '../utils/cover';
import { extractMetadataFromAiResponse, getMetadata } from './book-ai-metadata';
import { parseEditedFields } from './ai-batch-fill';
import { cleanBookTitle } from '../utils/book-title';
import { Adaptation } from './adaptations';
import { LookupOutcome, lookupBook } from './book-lookup';
import { LookupStep } from './book-lookup-agent';
import { buildLookupInput, confirmedMismatch, doubanNote, sameTitle, trustedConfirmation } from './lookup-merge';
import { extractAuthorFromName } from '../utils/title-normalizer';
import { finishLookupProgress, setLookupProgress, startLookupProgress } from './lookup-progress';
import { getCategoryTree, resolveCategoryPath } from '../utils/category-tree';

export { cleanBookTitle };

/**
 * 单本 AI 填充预览：只读，不写库、不落盘封面、不抓评分。
 * 用户在预览弹窗确认后由 ai-fill-apply 写入。
 */

export type LockableField = 'title' | 'author' | 'summary' | 'category';
export type SimilarWork = { title: string; author?: string; reason?: string };

export interface AiFillPreview {
  current: {
    title: string; author: string | null; summary: string | null; category: string | null;
    is_finished: boolean | null; cover_url: string | null;
    recommended_tags: string[]; similar_works: SimilarWork[];
    adaptations: Adaptation[];
  };
  suggested: {
    /** 查证确认的书名（与当前书名实质不同时才给；只进待确认） */
    title?: string;
    author?: string; summary?: string; category?: string; is_finished?: boolean;
    recommended_tags: string[]; similar_works: SimilarWork[];
    /** 改编作品：外部平台搜出的候选经 AI 筛选，每条都有来源链接 */
    adaptations: Adaptation[];
    /** 各字段置信度：low 表示只凭书名和模型知识，前端默认不采用 */
    confidence: Partial<Record<LockableField, FillConfidence>>;
    /** 各字段依据（AI 说明的来源） */
    evidence: Partial<Record<LockableField, string>>;
  };
  lockedFields: LockableField[];
  /** 默认封面上印的书名：AI 给出的书名，否则为清洗后的文件名书名（预览与保存一致） */
  coverTitle: string;
  coverCandidates: Array<DoubanCandidate & { thumbnail: string }>;
  /** 文件内置封面（data URI，目前只有 EPUB）；没有时省略 */
  embeddedCover?: string;
  /** AI 判定正文与文件名不是同一部作品时给出（预览只读，不写库；持久标记由后台批量填充写入） */
  contentMismatch?: { title: string; author?: string; reason?: string };
  /** AI 查证过程（搜了什么、打开了哪个条目） */
  lookupTrace: LookupStep[];
  /** 查证关闭或失败，走了原有检索 */
  lookupUsedFallback: boolean;
}

export class BookNotFoundError extends Error {
  constructor() { super('书籍不存在'); }
}

const LOCKABLE: LockableField[] = ['title', 'author', 'summary', 'category'];

const ADAPTATION_COVER_LIMIT = 6;

const FINISHED_KEYWORDS = /完本|完结|全集|全本|完整版|精校版|完稿/;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export async function buildAiFillPreview(bookId: string): Promise<AiFillPreview> {
  const db = getDb();
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as Book | undefined;
  if (!book) throw new BookNotFoundError();

  // 一开始就清掉上次的查证进度：60 秒内重开预览时，AI 填充阶段不显示上一次的步骤
  startLookupProgress(bookId);
  try {
    return await buildPreview(db, book);
  } finally {
    finishLookupProgress(bookId);
  }
}

async function buildPreview(db: Database.Database, book: Book): Promise<AiFillPreview> {
  const bookId = book.id;
  const cleanedTitle = cleanBookTitle(book.title);
  const evidence = await buildBookEvidence(book);
  const info = await aiManager.fillBookInfo(evidence.text, db) as Record<string, unknown>;
  // 分类只接受分类树中的路径（末级名可唯一对应时自动补全），否则不给建议
  info.category = resolveCategoryPath(getCategoryTree(db), str(info.category));
  let contentMismatch = detectContentMismatch(info);

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

  // AI 查证：认书、挑改编（关闭或失败时内部走原有检索）；错标时查证正文实际的书
  const outcome: LookupOutcome = await lookupBook(buildLookupInput({
    filePath: book.file_path, metadata: evidence.metadata, info,
    title: cleanedTitle, author: book.author ?? undefined, summary, mismatch: contentMismatch,
  }), db, { onStep: steps => setLookupProgress(bookId, steps) });
  // 确认的作者与当前作者（没有则取文件名中的作者）冲突时当作没有确认；封面候选顺序不变，由用户自己选
  const knownAuthor = (book.author ?? '').trim() || (extractAuthorFromName(path.basename(book.file_path)) ?? '');
  const confirmed = trustedConfirmation(outcome, { knownAuthor, mismatch: contentMismatch });
  const adaptations = outcome.adaptations;

  // 改编作品的海报 / 广播剧封面排在书封之后，带类型角标；没有 subjectUrl（评分只取书封的豆瓣条目）
  const adaptationCovers: DoubanCandidate[] = adaptations
    .filter(a => a.pic)
    .slice(0, ADAPTATION_COVER_LIMIT)
    .map(a => ({ title: a.title, ...(a.year ? { year: a.year } : {}), pic: a.pic!, kind: a.type }));
  // 缩略图并发下载，失败的候选丢弃
  const allCovers = [...outcome.coverCandidates, ...adaptationCovers];
  const thumbnails = await Promise.all(allCovers.map(c => fetchCoverThumbnailDataUri(c.pic)));
  const coverCandidates = allCovers.flatMap((c, i) => (thumbnails[i] ? [{ ...c, thumbnail: thumbnails[i]! }] : []));
  const embeddedCover = embeddedCoverDataUri(evidence.cover);

  const edited = new Set(parseEditedFields(book.manually_edited_fields));

  const confidence: Partial<Record<LockableField, FillConfidence>> = {};
  const evidenceNotes: Partial<Record<LockableField, string>> = {};
  const rawEvidence = info.evidence && typeof info.evidence === 'object' ? info.evidence as Record<string, unknown> : {};
  for (const f of LOCKABLE) {
    if (f === 'title' || !str(info[f])) continue;   // 书名建议只来自查证
    confidence[f] = fieldConfidence(info, f);
    const note = str(rawEvidence[f]);
    if (note) evidenceNotes[f] = note.slice(0, 200);
  }

  // 查证确认的书：非错标时给书名建议、覆盖作者；错标时改写错标信息（书名只进待确认）
  let suggestedTitle: string | undefined;
  let suggestedAuthor = str(info.author);
  if (confirmed) {
    if (contentMismatch) {
      contentMismatch = confirmedMismatch(contentMismatch, confirmed);
    } else {
      const note = doubanNote(confirmed);
      if (!sameTitle(confirmed.title, book.title)) suggestedTitle = confirmed.title;
      confidence.title = 'high';
      evidenceNotes.title = note;
      evidenceNotes.author = note;
      if (confirmed.author) {
        suggestedAuthor = confirmed.author;
        confidence.author = 'high';
      }
    }
  }

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
      adaptations: (current?.adaptations ?? []) as Adaptation[],
    },
    suggested: {
      ...(suggestedTitle ? { title: suggestedTitle } : {}),
      ...(suggestedAuthor ? { author: suggestedAuthor } : {}),
      ...(summary ? { summary } : {}),
      ...(str(info.category) ? { category: str(info.category) } : {}),
      is_finished: isFinished,
      recommended_tags: meta.tags,
      similar_works: meta.similar,
      adaptations: adaptations.map(({ pic: _pic, ...a }) => a),
      confidence,
      evidence: evidenceNotes,
    },
    lockedFields: LOCKABLE.filter(f => edited.has(f)),
    coverTitle: str(info.title) || cleanedTitle,
    coverCandidates,
    ...(embeddedCover ? { embeddedCover } : {}),
    ...(contentMismatch ? { contentMismatch } : {}),
    lookupTrace: outcome.steps,
    lookupUsedFallback: outcome.usedFallback,
  };
}
