import { describe, it, expect } from 'vitest'
import { readerPalette, hideLeadingTitle, countChapterChars } from './reader-style'

describe('readerPalette', () => {
  it('uses the exact spec colours for 护眼绿', () => {
    expect(readerPalette('green-paper', '#E0EEE1', 'rgba(0,0,0,.9)')).toEqual({
      '--reader-page-bg': '#C9E0CB',
      '--reader-paper-bg': '#E0EEE1',
      '--reader-text': 'rgba(0,0,0,.9)',
      '--reader-text-secondary': 'rgba(0,0,0,.48)',
      '--reader-divider': 'rgba(0,0,0,.08)',
    })
  })

  it('derives page / secondary / divider colours for other themes from bg and text', () => {
    const p = readerPalette('night', '#0b1020', '#c9d3ea')
    expect(p['--reader-paper-bg']).toBe('#0b1020')
    expect(p['--reader-text']).toBe('#c9d3ea')
    expect(p['--reader-page-bg']).toContain('color-mix')
    expect(p['--reader-page-bg']).toContain('#0b1020')
    expect(p['--reader-text-secondary']).toContain('#c9d3ea')
    expect(p['--reader-divider']).toContain('#c9d3ea')
  })
})

describe('hideLeadingTitle', () => {
  // 隐藏而不删除：段落序号保持不变，已保存的阅读位置（按段落定位）不受影响
  it('hides a first paragraph that repeats the chapter title', () => {
    expect(hideLeadingTitle('<p>第一章 绯红</p>\n<p>痛！</p>', '第一章 绯红')).toBe('<p hidden>第一章 绯红</p>\n<p>痛！</p>')
  })

  it('ignores whitespace and entity differences', () => {
    expect(hideLeadingTitle('  <p>第三章　&lt;序&gt;</p><p>正文</p>', '第三章 <序>')).toBe('  <p hidden>第三章　&lt;序&gt;</p><p>正文</p>')
  })

  it('hides a repeated EPUB heading, keeping its attributes', () => {
    expect(hideLeadingTitle('<h2 class="t">Chapter 1</h2><p>Body</p>', 'Chapter 1')).toBe('<h2 class="t" hidden>Chapter 1</h2><p>Body</p>')
  })

  it('keeps content whose first block is not the title', () => {
    const html = '<p>更多精校小说</p><p>第一章 绯红</p>'
    expect(hideLeadingTitle(html, '第一章 绯红')).toBe(html)
  })

  it('keeps content when the title is empty', () => {
    expect(hideLeadingTitle('<p>正文</p>', '')).toBe('<p>正文</p>')
  })
})

describe('countChapterChars', () => {
  it('counts visible characters, ignoring tags and whitespace', () => {
    expect(countChapterChars('<p>你好，世界</p>\n<p>  ab  </p>')).toBe(7)
  })

  it('counts entities as one character', () => {
    expect(countChapterChars('<p>a&amp;b&lt;</p>')).toBe(4)
  })
})
