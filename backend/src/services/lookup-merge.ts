import path from 'path';
import { BookFileMetadata } from '../types';
import { ConfirmedBook, LookupInput } from './book-lookup-agent';
import { authorsMatch } from '../utils/author-match';

/**
 * 单本预览与后台批量共用的查证合并规则：怎样组装查证输入、怎样比较书名、
 * 豆瓣依据怎么写、错标时怎样用确认结果改写错标信息。
 */

export type MismatchInfo = { title: string; author?: string; reason?: string };

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 文件内置书目信息的简短摘要（交给查证；不含正文节选） */
export function formatEmbedded(meta: BookFileMetadata): string | undefined {
  const parts = [
    meta.title ? `书名：${meta.title}` : '',
    meta.author ? `作者：${meta.author}` : '',
    meta.publisher ? `出版者：${meta.publisher}` : '',
    meta.date ? `出版日期：${meta.date}` : '',
    meta.isbn ? `ISBN：${meta.isbn}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('；') : undefined;
}

/** 比较书名时忽略空白与书名号 */
export function sameTitle(a: string, b: string): boolean {
  const norm = (t: string) => t.replace(/[\s《》〈〉]/g, '');
  return norm(a) === norm(b);
}

/** 豆瓣依据：「豆瓣：《书名》作者 年份；理由」 */
export function doubanNote(c: ConfirmedBook): string {
  const year = c.hit.year ?? c.detail?.year;
  // 豆瓣书名本身带书名号时（如「《聊斋志异》 蒲松龄 手稿本」）不再包一层
  const quoted = c.hit.title.includes('《');
  const rest = [c.doubanAuthor, year].filter(Boolean).join(' ');
  const head = `豆瓣：${quoted ? c.hit.title : `《${c.hit.title}》`}${quoted && rest ? ' ' : ''}${rest}`;
  return c.why ? `${head}；${c.why}` : head;
}

/**
 * 组装查证输入：书名 / 作者优先用 AI 填充结果，否则用调用方给的已知值；
 * 错标时查证正文实际的那本书。
 */
export function buildLookupInput(p: {
  filePath: string;
  metadata: BookFileMetadata;
  info: Record<string, unknown>;
  title: string;
  author?: string;
  summary?: string;
  mismatch?: MismatchInfo;
}): LookupInput {
  const embedded = formatEmbedded(p.metadata);
  const bookType = str(p.info.book_type);
  return {
    fileName: path.basename(p.filePath),
    ...(embedded ? { embedded } : {}),
    title: p.mismatch ? p.mismatch.title : (str(p.info.title) || p.title),
    author: p.mismatch ? p.mismatch.author : (str(p.info.author) ?? p.author),
    ...(bookType ? { bookType } : {}),
    ...(p.summary ? { summary: p.summary } : {}),
    ...(p.mismatch?.reason ? { mismatchReason: p.mismatch.reason } : {}),
  };
}

/** 错标且查证确认了正文那本书：书名 / 作者用确认结果，理由后附豆瓣依据 */
export function confirmedMismatch(m: MismatchInfo, c: ConfirmedBook): MismatchInfo {
  const note = doubanNote(c);
  const author = c.author ?? m.author;
  return {
    title: c.title,
    ...(author ? { author } : {}),
    reason: m.reason ? `${m.reason}${/[。！？.!?；;]$/.test(m.reason) ? '' : '；'}${note}` : note,
  };
}

/**
 * 可信的确认结果：确认的作者与已知作者（书的当前作者或文件名中的作者）对不上时多半认错了书，
 * 当作没有确认（不覆盖作者、不给书名建议、不写豆瓣依据）。错标时查的是正文那本书，不比对。
 */
export function trustedConfirmation<T extends ConfirmedBook>(
  outcome: { confirmed?: T },
  opts: { knownAuthor: string; mismatch?: MismatchInfo },
): T | undefined {
  const c = outcome.confirmed;
  if (!c || opts.mismatch || !c.author || !opts.knownAuthor) return c;
  return authorsMatch(c.author, opts.knownAuthor) ? c : undefined;
}
