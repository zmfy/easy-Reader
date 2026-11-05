import { ChapterParas } from './book-text';

export interface Position { chapterIndex: number; paragraphIndex: number }
export interface Source extends Position { chapterTitle: string }

function countOccurrences(text: string, label: string): number {
  let n = 0;
  for (let at = text.indexOf(label); at !== -1; at = text.indexOf(label, at + label.length)) n++;
  return n;
}

/**
 * 选出处章节：① 章节标题包含 label 的最早一章；② 否则 label 出现次数最多的章，平局取较早；
 * 段落 = 该章首次出现的段落。全书不出现 → null。label 去首尾空白，长度 < 2 → null
 */
export function findSource(chapters: ChapterParas[], label: string): Source | null {
  const key = label.trim();
  if (key.length < 2) return null;

  const firstParagraph = (c: ChapterParas) => c.paragraphs.findIndex(p => p.includes(key));
  const toSource = (c: ChapterParas): Source | null => {
    const paragraphIndex = firstParagraph(c);
    return paragraphIndex < 0 ? null : { chapterIndex: c.index, paragraphIndex, chapterTitle: c.title };
  };

  // 标题命中的章节正文里不一定出现 label，此时跳过，继续找下一个标题命中的章
  for (const c of chapters) {
    if (c.title.includes(key)) {
      const s = toSource(c);
      if (s) return s;
    }
  }

  let best: ChapterParas | null = null;
  let bestCount = 0;
  for (const c of chapters) {
    const count = c.paragraphs.reduce((sum, p) => sum + countOccurrences(p, key), 0);
    if (count > bestCount) { best = c; bestCount = count; }
  }
  return best ? toSource(best) : null;
}

/** a 严格晚于 b：先比章再比段 */
export function isAfter(a: Position, b: Position): boolean {
  if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex > b.chapterIndex;
  return a.paragraphIndex > b.paragraphIndex;
}
