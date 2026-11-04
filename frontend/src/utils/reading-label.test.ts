import { describe, it, expect } from 'vitest'
import { readButtonLabel } from './reading-label'

describe('readButtonLabel', () => {
  it('says 开始阅读 for a book never opened (or progress unknown)', () => {
    expect(readButtonLabel(null)).toBe('开始阅读')
    expect(readButtonLabel({ hasProgress: false, chapterIndex: 0, scrollTop: 0 })).toBe('开始阅读')
  })

  it('names the chapter to continue from', () => {
    expect(readButtonLabel({ hasProgress: true, chapterIndex: 4, chapterTitle: '第五章 雪夜', scrollTop: 0 })).toBe('继续阅读 · 第五章 雪夜')
  })

  it('falls back to the chapter number when the title is empty', () => {
    expect(readButtonLabel({ hasProgress: true, chapterIndex: 0, chapterTitle: '', scrollTop: 0 })).toBe('继续阅读 · 第 1 章')
  })
})
