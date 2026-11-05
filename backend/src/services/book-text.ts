import { getReaderPlugin } from '../plugins/plugin-manager';
import { Book } from '../types';
import { chapterParagraphs } from './ai-reading';

export interface ChapterParas { index: number; title: string; paragraphs: string[] }

const CACHE_CAPACITY = 2;
// Map 按插入顺序迭代：命中时删除再插入，队首即最久未使用
const cache = new Map<string, ChapterParas[]>();

/** 读取整书各章段落（复用 chapterParagraphs）；按 book.id + file_path 做 LRU 缓存，容量 2 本 */
export async function getBookText(book: Book): Promise<ChapterParas[]> {
  const key = `${book.id}\n${book.file_path}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const plugin = await getReaderPlugin(book);
  const chapters = await plugin.getChapters();
  const result: ChapterParas[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const html = await plugin.getChapterContent(i);
    result.push({ index: i, title: chapters[i]?.title || `第 ${i + 1} 章`, paragraphs: chapterParagraphs(html) });
  }
  cache.set(key, result);
  while (cache.size > CACHE_CAPACITY) {
    cache.delete(cache.keys().next().value as string);
  }
  return result;
}

export function clearBookTextCache(): void {
  cache.clear();
}
