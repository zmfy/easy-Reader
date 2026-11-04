import { describe, it, expect } from 'vitest'
import { readerKeyAction } from './reader-keys'

const key = (k: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
  ({ key: k, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods })

describe('readerKeyAction', () => {
  it('maps arrows to chapter navigation', () => {
    expect(readerKeyAction(key('ArrowLeft'))).toBe('prevChapter')
    expect(readerKeyAction(key('ArrowRight'))).toBe('nextChapter')
  })

  it('maps space / page keys to scrolling one screen', () => {
    expect(readerKeyAction(key(' '))).toBe('pageDown')
    expect(readerKeyAction(key('PageDown'))).toBe('pageDown')
    expect(readerKeyAction(key(' ', { shiftKey: true }))).toBe('pageUp')
    expect(readerKeyAction(key('PageUp'))).toBe('pageUp')
  })

  it('keeps B for bookmarks', () => {
    expect(readerKeyAction(key('b'))).toBe('bookmark')
    expect(readerKeyAction(key('B', { shiftKey: true }))).toBe('bookmark')
  })

  it('ignores combinations with ctrl / alt / meta (browser shortcuts)', () => {
    expect(readerKeyAction(key('ArrowLeft', { altKey: true }))).toBeNull()
    expect(readerKeyAction(key('b', { ctrlKey: true }))).toBeNull()
    expect(readerKeyAction(key(' ', { metaKey: true }))).toBeNull()
  })

  it('ignores other keys', () => {
    expect(readerKeyAction(key('a'))).toBeNull()
    expect(readerKeyAction(key('ArrowDown'))).toBeNull()
  })
})
