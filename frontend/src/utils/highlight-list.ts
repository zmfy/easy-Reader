import type { Highlight } from '../types'

export interface HighlightGroup { chapterIndex: number; chapterTitle: string; items: Highlight[] }

// 按章节升序分组，组内按 start_offset 升序；章节不存在或无标题时用「第 N 章」
export function groupHighlightsByChapter(list: Highlight[], chapters: Array<{ index: number; title: string }>): HighlightGroup[] {
  const titles = new Map(chapters.map(c => [c.index, c.title]))
  const groups = new Map<number, Highlight[]>()
  for (const h of list) {
    const arr = groups.get(h.chapter_index)
    if (arr) arr.push(h)
    else groups.set(h.chapter_index, [h])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapterIndex, items]) => ({
      chapterIndex,
      chapterTitle: titles.get(chapterIndex) || `第 ${chapterIndex + 1} 章`,
      items: [...items].sort((a, b) => a.start_offset - b.start_offset),
    }))
}
