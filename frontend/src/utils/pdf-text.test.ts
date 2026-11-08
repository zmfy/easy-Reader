import { describe, it, expect } from 'vitest'
import { dedupeTextItems, eolSeparator, pageHasText } from './pdf-text'

const item = (str: string, x: number, y: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], hasEOL })

describe('pdf-text', () => {
  it('dedupeTextItems drops fake-bold copies', () => {
    const items = [item('重要', 100, 700), item('重要', 100.4, 700.3), item('重要', 300, 700), item('其他', 100, 680)]
    expect(dedupeTextItems(items).map(i => [i.str, i.transform[4]])).toEqual([['重要', 100], ['重要', 300], ['其他', 100]])
  })

  it('dedupeTextItems keeps empty items (they carry line ends)', () => {
    const items = [item('a', 0, 0), item('', 0, 0, true), item('', 0, 0, true)]
    expect(dedupeTextItems(items)).toHaveLength(3)
  })

  it('eolSeparator follows the backend join rule', () => {
    expect(eolSeparator('quick', 'brown')).toBe(' ')
    expect(eolSeparator('中文', '内容')).toBe('')
    expect(eolSeparator('end ', 'next')).toBe('')
    expect(eolSeparator('end', ' next')).toBe('')
    expect(eolSeparator('abc', '中')).toBe('')
    expect(eolSeparator('', 'x')).toBe('')
    expect(eolSeparator('x', '')).toBe('')
  })

  it('pageHasText treats whitespace-only pages as no text', () => {
    expect(pageHasText([])).toBe(false)
    expect(pageHasText([item(' ', 0, 0), item('　', 0, 0), item('', 0, 0, true)])).toBe(false)
    expect(pageHasText([item(' ', 0, 0), item('a', 0, 0)])).toBe(true)
  })
})
