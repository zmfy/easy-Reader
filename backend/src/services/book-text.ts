import fs from 'fs';
import { getReaderPlugin } from '../plugins/plugin-manager';
import { Book } from '../types';
import { chapterParagraphs } from './ai-reading';

export interface ChapterParas { index: number; title: string; paragraphs: string[] }

const CACHE_CAPACITY = 2;
const YIELD_EVERY = 50; // 每读 50 章让出一次事件循环，避免大书长时间阻塞
// Map 按插入顺序迭代：命中时删除再插入，队首即最久未使用
const cache = new Map<string, ChapterParas[]>();
// 同一缓存键的并发冷读共用一个 Promise，失败时删除
const inflight = new Map<string, Promise<ChapterParas[]>>();

/** 缓存键 = book.id + file_path + 文件修改时间（stat 失败时按 0 处理） */
function cacheKey(book: Book): string {
  let mtime = 0;
  try {
    mtime = fs.statSync(book.file_path).mtimeMs;
  } catch {
    // 忽略：文件不可 stat 时仍按 id + 路径缓存
  }
  return `${book.id}\n${book.file_path}\n${mtime}`;
}

async function readBookText(book: Book): Promise<ChapterParas[]> {
  const plugin = await getReaderPlugin(book);
  const chapters = await plugin.getChapters();
  const result: ChapterParas[] = [];
  for (let i = 0; i < chapters.length; i++) {
    if (i > 0 && i % YIELD_EVERY === 0) await new Promise(r => setImmediate(r));
    const html = await plugin.getChapterContent(i);
    result.push({ index: i, title: chapters[i]?.title || `第 ${i + 1} 章`, paragraphs: chapterParagraphs(html) });
  }
  return result;
}

/** 读取整书各章段落（复用 chapterParagraphs）；按 book.id + file_path + mtime 做 LRU 缓存，容量 2 本 */
export async function getBookText(book: Book): Promise<ChapterParas[]> {
  const key = cacheKey(book);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = readBookText(book).then(result => {
    inflight.delete(key);
    cache.set(key, result);
    while (cache.size > CACHE_CAPACITY) {
      cache.delete(cache.keys().next().value as string);
    }
    return result;
  }, err => {
    inflight.delete(key);
    throw err;
  });
  inflight.set(key, promise);
  return promise;
}

/** 只读一章的段落（整书已在缓存时直接取缓存）；章节不存在 → null */
export async function getChapterText(book: Book, chapterIndex: number): Promise<ChapterParas | null> {
  const hit = cache.get(cacheKey(book));
  if (hit) return hit[chapterIndex] ?? null;
  const plugin = await getReaderPlugin(book);
  const chapters = await plugin.getChapters();
  if (chapterIndex < 0 || chapterIndex >= chapters.length) return null;
  const html = await plugin.getChapterContent(chapterIndex);
  return {
    index: chapterIndex,
    title: chapters[chapterIndex]?.title || `第 ${chapterIndex + 1} 章`,
    paragraphs: chapterParagraphs(html),
  };
}

export function clearBookTextCache(): void {
  cache.clear();
  inflight.clear();
}
