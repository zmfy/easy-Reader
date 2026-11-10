import { describe, it, expect } from 'vitest'
import { readerKeyAction, pageScrollDistance, alignedPageDistance, contentTapAction } from './reader-keys'

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

  it('maps up / down arrows to scrolling one screen', () => {
    expect(readerKeyAction(key('ArrowDown'))).toBe('pageDown')
    expect(readerKeyAction(key('ArrowUp'))).toBe('pageUp')
  })

  it('ignores other keys', () => {
    expect(readerKeyAction(key('a'))).toBeNull()
    expect(readerKeyAction(key('Home'))).toBeNull()
  })
})

describe('pageScrollDistance', () => {
  it('keeps the last two lines of the previous screen visible', () => {
    // 字号 18px、行高 1.8 → 一行 32.4px，保留两行
    expect(pageScrollDistance(856, 18 * 1.8)).toBeCloseTo(856 - 64.8)
  })

  it('keeps more overlap for larger text', () => {
    expect(pageScrollDistance(856, 32 * 2.5)).toBe(856 - 160)
  })

  it('never scrolls less than half a screen on tiny viewports', () => {
    expect(pageScrollDistance(200, 80)).toBe(100)
  })
})

describe('alignedPageDistance', () => {
  // 视口顶部 y=56、高 900；目标行（距底部约两行）顶部在 y=860
  it('scrolls so the target line starts just below the top edge', () => {
    expect(alignedPageDistance(860, 56, 900)).toBe(860 - 56 - 8)
  })

  it('never scrolls less than half a screen', () => {
    expect(alignedPageDistance(200, 56, 900)).toBe(450)
  })

  it('never scrolls more than a full screen', () => {
    expect(alignedPageDistance(2000, 56, 900)).toBe(900)
  })
})

describe('contentTapAction', () => {
  it('开启点击翻页：左侧上翻、右侧下翻、中间呼出菜单', () => {
    expect(contentTapAction(50, 400, true)).toBe('pageUp')
    expect(contentTapAction(350, 400, true)).toBe('pageDown')
    expect(contentTapAction(200, 400, true)).toBe('toggle')
  })
  it('关闭时点哪里都只呼出菜单', () => {
    expect(contentTapAction(50, 400, false)).toBe('toggle')
    expect(contentTapAction(350, 400, false)).toBe('toggle')
  })
})
