import { describe, it, expect } from 'vitest'
import { groupHighlightsByChapter } from './highlight-list'
import type { Highlight } from '../types'

const h = (id: string, chapter_index: number, start_offset: number): Highlight => ({
  id, user_id: 'u', book_id: 'b', chapter_index, start_offset, end_offset: start_offset + 2,
  text: id, note: null, created_at: '', updated_at: '',
})

describe('groupHighlightsByChapter', () => {
  it('groups and orders by chapter then offset', () => {
    const groups = groupHighlightsByChapter(
      [h('c', 2, 5), h('a', 0, 30), h('b', 0, 10)],
      [{ index: 0, title: '序' }, { index: 2, title: '终章' }],
    )
    expect(groups.map(g => [g.chapterIndex, g.chapterTitle])).toEqual([[0, '序'], [2, '终章']])
    expect(groups[0].items.map(i => i.id)).toEqual(['b', 'a'])
    expect(groups[1].items.map(i => i.id)).toEqual(['c'])
  })

  it('falls back to 第 N 章 for unknown chapters', () => {
    const groups = groupHighlightsByChapter([h('x', 6, 0)], [{ index: 0, title: '序' }])
    expect(groups[0].chapterTitle).toBe('第 7 章')
  })

  it('falls back when the title is empty', () => {
    expect(groupHighlightsByChapter([h('x', 1, 0)], [{ index: 1, title: '' }])[0].chapterTitle).toBe('第 2 章')
  })
})
