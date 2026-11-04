// 阅读器 AI 功能的执行层：读取已读章节 → 构建提示词 → 调用 AI；前情提要按阅读位置缓存。
// 防剧透：只读取当前章之前的章节和当前章已读的段落，之后的内容不会进入提示词。
import Database from 'better-sqlite3';
import { aiManager } from '../ai/ai-manager';
import { getReaderPlugin } from '../plugins/plugin-manager';
import { Book } from '../types';
import {
  chapterParagraphs, readPart, clipMiddle, extractQueryTerms, findRelevantSnippets,
  buildRecapPrompt, buildAskPrompt, cleanAiText, ChapterText,
} from './ai-reading';

const RECAP_CHAPTERS = 3;          // 前情提要回看的章节数
const CHAPTER_CLIP = 4000;         // 每章送给 AI 的最大字数
const MAX_HISTORY = 3;             // 问书带上的对话轮数

export interface RecapResult { content: string; cached: boolean; chapters: string[] }
export interface AskResult { answer: string; sources: Array<{ chapterIndex: number; title: string }> }

async function loadChapter(book: Book, index: number) {
  const plugin = await getReaderPlugin(book);
  const chapters = await plugin.getChapters();
  const title = (i: number) => chapters[i]?.title || `第 ${i + 1} 章`;
  return { plugin, chapters, title, current: Math.min(Math.max(0, index), Math.max(0, chapters.length - 1)) };
}

export async function generateRecap(db: Database.Database, book: Book, chapterIndex: number, paragraphIndex: number): Promise<RecapResult> {
  const { plugin, title, current } = await loadChapter(book, chapterIndex);
  const from = Math.max(0, current - RECAP_CHAPTERS);
  const titles = Array.from({ length: current - from + 1 }, (_, k) => title(from + k));

  const cached = db.prepare('SELECT content FROM ai_recaps WHERE book_id = ? AND chapter_index = ? AND paragraph_index = ?')
    .get(book.id, current, paragraphIndex) as { content: string } | undefined;
  if (cached) return { content: cached.content, cached: true, chapters: titles };

  const parts: Array<{ title: string; text: string }> = [];
  for (let i = from; i < current; i++) {
    parts.push({ title: title(i), text: clipMiddle(chapterParagraphs(await plugin.getChapterContent(i)).join('\n'), CHAPTER_CLIP) });
  }
  parts.push({ title: `${title(current)}（读到这里）`, text: clipMiddle(readPart(await plugin.getChapterContent(current), paragraphIndex), CHAPTER_CLIP) });

  const content = cleanAiText(await aiManager.chat(buildRecapPrompt(book.title, parts), db));
  if (!content) throw new Error('AI 没有返回内容');
  db.prepare('INSERT OR REPLACE INTO ai_recaps (book_id, chapter_index, paragraph_index, content) VALUES (?, ?, ?, ?)')
    .run(book.id, current, paragraphIndex, content);
  return { content, cached: false, chapters: titles };
}

export async function answerQuestion(
  db: Database.Database,
  book: Book,
  input: { question: string; chapterIndex: number; paragraphIndex: number; history: Array<{ q: string; a: string }> },
): Promise<AskResult> {
  const { plugin, title, current } = await loadChapter(book, input.chapterIndex);

  // 已读章节全文（只到当前章之前）用于本地检索，不会整体发给 AI
  const read: ChapterText[] = [];
  for (let i = 0; i < current; i++) {
    read.push({ index: i, title: title(i), text: chapterParagraphs(await plugin.getChapterContent(i)).join('\n') });
  }
  const currentText = clipMiddle(readPart(await plugin.getChapterContent(current), input.paragraphIndex), CHAPTER_CLIP);

  const corpus = read.map(c => c.text).join('\n') + '\n' + currentText;
  const terms = extractQueryTerms(input.question, corpus);
  let snippets = findRelevantSnippets(terms, read);
  // 问题里没有可检索的词（如「上一章发生了什么」）：带上前一章
  if (snippets.length === 0 && read.length > 0) {
    const prev = read[read.length - 1];
    snippets = [{ chapterIndex: prev.index, title: prev.title, text: clipMiddle(prev.text, CHAPTER_CLIP) }];
  }

  const prompt = buildAskPrompt({
    bookTitle: book.title,
    question: input.question,
    snippets,
    current: { title: title(current), text: currentText },
    history: input.history.slice(-MAX_HISTORY),
  });
  const answer = cleanAiText(await aiManager.chat(prompt, db));
  if (!answer) throw new Error('AI 没有返回内容');
  return { answer, sources: snippets.map(s => ({ chapterIndex: s.chapterIndex, title: s.title })) };
}
