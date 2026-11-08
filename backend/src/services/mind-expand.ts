// AI 展开知识点：以划线（或其下某个知识点）为中心，让 AI 发散 5–8 个相关知识点。
// 防剧透：送给 AI 的原文只取划线附近、且不超过阅读边界的段落；出处由系统全书检索，边界之后的标 later。
import Database from 'better-sqlite3';
import { aiManager } from '../ai/ai-manager';
import { Book } from '../types';
import { cleanAiText, clipMiddle } from './ai-reading';
import { getBookText, getChapterText } from './book-text';
import { listMindNodes, MindNode } from './mind-nodes';
import { findSource, isAfter, Position, Source } from './mind-source';

const CENTER_MAX = 30;      // 缺省中心词 = 划线原文前 30 字
const ANCHOR_MAX = 20;      // 跨段划线按前 20 字定位段落
const CONTEXT_BEFORE = 3;   // 划线段落之前带的段数
const CONTEXT_AFTER = 2;    // 划线段落之后带的段数（仍受边界限制）
const CONTEXT_CLIP = 3000;  // 上下文最大字数
const LABEL_MAX = 20;
const SUMMARY_MAX = 80;
const MAX_CANDIDATES = 8;
const KINDS = ['event', 'concept', 'person'] as const;

export interface Candidate { label: string; kind: 'event' | 'concept' | 'person'; summary: string }
export interface ExpandedCandidate extends Candidate {
  source: { chapterIndex: number; paragraphIndex: number; chapterTitle: string; later: boolean } | null
}
type StoredCandidate = Candidate & { source: Source | null };

export class AiBadOutputError extends Error {
  constructor(message = 'AI 返回格式不正确') {
    super(message);
    this.name = 'AiBadOutputError';
  }
}

/** 按字符（码点）截断，避免切开代理对 */
function takeChars(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('');
}

/** 解析 AI 输出的 JSON 数组；丢弃非法 / 重复 / 与 exclude 相同的项。一个不剩 → AiBadOutputError */
export function parseExpandResult(raw: string, exclude: string[]): Candidate[] {
  const text = cleanAiText(raw).replace(/```[a-z]*\s*/gi, '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new AiBadOutputError();
  let items: unknown;
  try {
    items = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiBadOutputError();
  }
  if (!Array.isArray(items)) throw new AiBadOutputError();

  const seen = new Set(exclude.map(s => s.trim()));
  const result: Candidate[] = [];
  for (const item of items) {
    if (result.length >= MAX_CANDIDATES) break;
    if (!item || typeof item !== 'object') continue;
    const { label, kind, summary } = item as Record<string, unknown>;
    if (typeof label !== 'string' || !KINDS.includes(kind as Candidate['kind'])) continue;
    const l = takeChars(label.trim(), LABEL_MAX);
    if (!l || seen.has(l)) continue;
    seen.add(l);
    result.push({
      label: l,
      kind: kind as Candidate['kind'],
      summary: takeChars(typeof summary === 'string' ? summary.trim() : '', SUMMARY_MAX),
    });
  }
  if (result.length === 0) throw new AiBadOutputError();
  return result;
}

export function buildExpandPrompt(input: {
  bookTitle: string; author?: string | null; chapterTitle: string; highlight: string;
  context: string; center: string; path: string[];
}): string {
  const { bookTitle, author, chapterTitle, highlight, context, center, path } = input;
  const parts = [
    `你是读书笔记助手。读者在读《${bookTitle}》${author ? `（作者：${author}）` : ''}时划了一句话，想围绕它整理知识点。`,
    `请以「${center}」为中心，结合书名、章节、原文片段和上级路径，发散出 5–8 个相关的知识点（事件、概念或人物）：`,
    '- 可以运用你自己的知识（历史背景、相关概念、人物生平等）；',
    '- 不要编造原文中没有的情节，也不要推测读者尚未读到的内容；',
    '- 不确定的内容请在 summary 中注明「（存疑）」；',
    '- label 是简短的名称（不超过 20 字），summary 是一句话说明（不超过 80 字），用简体中文；',
    '- 不要重复中心词和上级路径中已有的词。',
    '只输出 JSON 数组，不要任何其他文字，格式：',
    '[{"label":"","kind":"event|concept|person","summary":""}]',
    '',
    `【章节】${chapterTitle}`,
    `【划线原文】${highlight}`,
  ];
  if (path.length > 0) parts.push(`【上级路径】${path.join(' → ')} → ${center}`);
  parts.push('', '【原文片段】', context || '（无）');
  return parts.join('\n');
}

const noSpace = (s: string) => s.replace(/\s+/g, '');

/**
 * 划线所在段落：先找包含全文的段落，跨段时用前 20 字定位，取第一处；
 * 再去掉所有空白各试一次（PDF 前端文字层与后端抽取的文字空白可能不同）；找不到 → -1
 */
export function findHighlightParagraph(paragraphs: string[], text: string): number {
  const full = text.trim();
  const anchor = takeChars(full.split('\n')[0].trim(), ANCHOR_MAX);
  for (const needle of [full, anchor]) {
    if (!needle) continue;
    const i = paragraphs.findIndex(p => p.includes(needle));
    if (i >= 0) return i;
  }
  const compact = paragraphs.map(noSpace);
  for (const needle of [noSpace(full), takeChars(noSpace(full), ANCHOR_MAX)]) {
    if (!needle) continue;
    const i = compact.findIndex(p => p.includes(needle));
    if (i >= 0) return i;
  }
  return -1;
}

/** 划线所在段落；找不到取 0 */
export function locateHighlightParagraph(paragraphs: string[], text: string): number {
  return Math.max(0, findHighlightParagraph(paragraphs, text));
}

/** PDF 上下文范围：整页视为已读，不按阅读边界截断；找不到划线时取整页 */
export function pdfContextRange(paragraphCount: number, found: number): { from: number; to: number } {
  if (found < 0) return { from: 0, to: paragraphCount - 1 };
  return { from: Math.max(0, found - CONTEXT_BEFORE), to: Math.min(paragraphCount - 1, found + CONTEXT_AFTER) };
}

/** PDF 的划线位置与阅读边界：划线所在页整页视为已读 */
function pdfPositions(chapterIndex: number, paragraphs: string[], text: string, progress: Position | null) {
  const found = findHighlightParagraph(paragraphs, text);
  const pageEnd: Position = { chapterIndex, paragraphIndex: Math.max(0, paragraphs.length - 1) };
  return { found, boundary: readingBoundary(progress, pageEnd) };
}

/** 阅读边界 = 进度与划线位置中较晚者；无进度 = 划线位置 */
export function readingBoundary(progress: Position | null, highlight: Position): Position {
  return progress && isAfter(progress, highlight) ? progress : highlight;
}

/** 上下文段落范围 [from, to]：划线段落前 3 段 + 划线段落 + 后 2 段中不超过边界的部分；一段都没有时 to < from */
export function expandContextRange(
  chapterIndex: number, paragraphCount: number, highlightParagraph: number, boundary: Position
): { from: number; to: number } {
  const from = Math.max(0, highlightParagraph - CONTEXT_BEFORE);
  const last = Math.min(paragraphCount - 1, highlightParagraph + CONTEXT_AFTER);
  let to = from - 1;
  for (let i = from; i <= last; i++) {
    if (isAfter({ chapterIndex, paragraphIndex: i }, boundary)) break;
    to = i;
  }
  return { from, to };
}

/** 划线段落前 3 段 + 划线段落 + 后 2 段中不超过边界的部分，整体截到 3000 字 */
export function buildExpandContext(
  chapterIndex: number, paragraphs: string[], highlightParagraph: number, boundary: Position
): string {
  const { from, to } = expandContextRange(chapterIndex, paragraphs.length, highlightParagraph, boundary);
  return clipMiddle(paragraphs.slice(from, to + 1).join('\n'), CONTEXT_CLIP);
}

/** 某用户的阅读进度；无记录 → null */
function readProgress(db: Database.Database, userId: string, bookId: string): Position | null {
  const row = db
    .prepare('SELECT chapter_index, paragraph_index FROM reading_progress WHERE user_id = ? AND book_id = ?')
    .get(userId, bookId) as { chapter_index: number | null; paragraph_index: number | null } | undefined;
  return row ? { chapterIndex: row.chapter_index ?? 0, paragraphIndex: row.paragraph_index ?? 0 } : null;
}

/**
 * 展开划线（或其下某个知识点）。划线不存在 / 非本人 → null；AI 输出无法解析 → 抛 AiBadOutputError，不写缓存。
 * 缓存按 (book_id, center, 划线章节, 实际送给 AI 的段落范围) 跨用户共享：边界更早的用户不会命中上下文更靠后的缓存。
 * 只读划线所在章计算边界与上下文；整书文本只在未命中缓存、需要检索出处时才读。later 每次按当前用户的阅读边界重算。
 */
export async function expandHighlight(db: Database.Database, book: Book, userId: string, input: {
  highlightId: string; center?: string; path?: string[]; force?: boolean
}): Promise<{ candidates: ExpandedCandidate[]; cached: boolean } | null> {
  const hl = db
    .prepare('SELECT chapter_index, text FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?')
    .get(input.highlightId, userId, book.id) as { chapter_index: number; text: string } | undefined;
  if (!hl) return null;

  const center = input.center?.trim() || takeChars(hl.text.trim(), CENTER_MAX);
  const path = input.path ?? [];
  const exclude = new Set([center, ...path].map(s => s.trim()));
  const chapter = await getChapterText(book, hl.chapter_index);
  const paragraphs = chapter?.paragraphs ?? [];
  const progress = readProgress(db, userId, book.id);
  let boundary: Position;
  let range: { from: number; to: number };
  if (book.file_format === 'pdf') {
    const pos = pdfPositions(hl.chapter_index, paragraphs, hl.text, progress);
    boundary = pos.boundary;
    range = pdfContextRange(paragraphs.length, pos.found);
  } else {
    const highlightPos: Position = {
      chapterIndex: hl.chapter_index,
      paragraphIndex: locateHighlightParagraph(paragraphs, hl.text),
    };
    boundary = readingBoundary(progress, highlightPos);
    range = expandContextRange(hl.chapter_index, paragraphs.length, highlightPos.paragraphIndex, boundary);
  }
  const key = [book.id, center, hl.chapter_index, range.from, range.to] as const;

  const withLater = (stored: StoredCandidate[], cached: boolean) => ({
    cached,
    candidates: stored.map((c): ExpandedCandidate => ({
      ...c,
      source: c.source ? { ...c.source, later: isAfter(c.source, boundary) } : null,
    })),
  });

  if (!input.force) {
    const row = db
      .prepare(`SELECT result FROM ai_expansions
                WHERE book_id = ? AND center = ? AND chapter_index = ? AND ctx_from = ? AND ctx_to = ?`)
      .get(...key) as { result: string } | undefined;
    let stored: StoredCandidate[] | null = null;
    if (row) {
      try {
        const parsed = JSON.parse(row.result);
        if (Array.isArray(parsed)) stored = parsed as StoredCandidate[];
      } catch {
        // 缓存损坏按未命中处理
      }
    }
    // 命中时按本次的中心词与路径再过滤一遍
    const filtered = stored?.filter(c => c && typeof c.label === 'string' && !exclude.has(c.label.trim()));
    if (filtered && filtered.length > 0) return withLater(filtered, true);
  }

  const prompt = buildExpandPrompt({
    bookTitle: book.title,
    author: book.author,
    chapterTitle: chapter?.title ?? `第 ${hl.chapter_index + 1} 章`,
    highlight: hl.text,
    context: clipMiddle(paragraphs.slice(range.from, range.to + 1).join('\n'), CONTEXT_CLIP),
    center,
    path,
  });
  const candidates = parseExpandResult(await aiManager.chat(prompt, db), [...exclude]);
  const chapters = await getBookText(book);
  const stored: StoredCandidate[] = candidates.map(c => ({ ...c, source: findSource(chapters, c.label) }));
  db.prepare(`INSERT OR REPLACE INTO ai_expansions (book_id, center, chapter_index, ctx_from, ctx_to, result)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(...key, JSON.stringify(stored));
  return withLater(stored, false);
}

export type MindNodeWithLater = MindNode & { source_later: boolean };

/**
 * 导图节点列表，附 source_later：出处是否在当前用户的阅读边界之后。
 * 边界 = max(阅读进度, 划线位置)，与展开时同一套算法；每个不同的划线只读一次其所在章。
 */
export async function listMindNodesWithLater(
  db: Database.Database, book: Book, userId: string, highlightId?: string
): Promise<MindNodeWithLater[]> {
  const nodes = listMindNodes(db, userId, book.id, highlightId);
  const progress = readProgress(db, userId, book.id);
  const boundaries = new Map<string, Position | null>();
  const hlStmt = db.prepare('SELECT chapter_index, text FROM highlights WHERE id = ? AND user_id = ? AND book_id = ?');

  const boundaryOf = async (hid: string | null): Promise<Position | null> => {
    if (!hid) return progress;
    if (boundaries.has(hid)) return boundaries.get(hid)!;
    const hl = hlStmt.get(hid, userId, book.id) as { chapter_index: number; text: string } | undefined;
    let b: Position | null = progress;
    if (hl) {
      let paragraphs: string[] = [];
      try {
        paragraphs = (await getChapterText(book, hl.chapter_index))?.paragraphs ?? [];
      } catch (err) {
        console.error(`[mind-nodes] book=${book.id} chapter=${hl.chapter_index} 读取失败`, err);
      }
      b = book.file_format === 'pdf'
        ? pdfPositions(hl.chapter_index, paragraphs, hl.text, progress).boundary
        : readingBoundary(progress, { chapterIndex: hl.chapter_index, paragraphIndex: locateHighlightParagraph(paragraphs, hl.text) });
    }
    boundaries.set(hid, b);
    return b;
  };

  const result: MindNodeWithLater[] = [];
  for (const n of nodes) {
    let later = false;
    if (n.source_chapter != null) {
      const b = await boundaryOf(n.highlight_id);
      const src = { chapterIndex: n.source_chapter, paragraphIndex: n.source_paragraph ?? 0 };
      later = b ? isAfter(src, b) : false;
    }
    result.push({ ...n, source_later: later });
  }
  return result;
}
