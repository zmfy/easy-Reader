import { describe, it, expect } from 'vitest'
import { readerPalette, hideLeadingTitle, countChapterChars, isDarkReaderTheme, nightToggleTheme, migrateReaderTheme, isImagePage } from './reader-style'

describe('readerPalette', () => {
  it('uses fixed 靛青 colours matching the site theme, accent follows the site accent', () => {
    expect(readerPalette('indigo', '#ffffff', '#1a2440')).toEqual({
      '--reader-page-bg': '#eef1f6',
      '--reader-paper-bg': '#ffffff',
      '--reader-text': '#1a2440',
      '--reader-text-secondary': '#8a94a6',
      '--reader-divider': '#e8ecf4',
      '--reader-panel-bg': '#ffffff',
      '--reader-panel-shadow': '0 1px 2px rgba(26,36,64,.04), 0 8px 32px rgba(26,36,64,.12)',
      '--reader-accent': 'var(--accent)',
      '--reader-accent-weak': 'color-mix(in srgb, var(--accent) 10%, #ffffff)',
      '--reader-hover-bg': 'rgba(26,36,64,.04)',
      '--reader-active-bg': 'rgba(26,36,64,.07)',
      '--reader-text-2': '#4a5568',
    })
  })

  it('derives colours for other themes from bg and text', () => {
    const p = readerPalette('white', '#FFFFFF', '#333333')
    expect(p['--reader-paper-bg']).toBe('#FFFFFF')
    expect(p['--reader-text']).toBe('#333333')
    for (const k of ['--reader-page-bg', '--reader-text-secondary', '--reader-divider', '--reader-hover-bg', '--reader-active-bg', '--reader-text-2']) {
      expect(p[k]).toContain('color-mix')
    }
    expect(p['--reader-accent']).toBe('var(--accent)')
  })

  it('lightens the accent and deepens the shadow on dark themes', () => {
    const light = readerPalette('white', '#FFFFFF', '#333333')
    const dark = readerPalette('night', '#0b1020', '#c9d3ea')
    expect(dark['--reader-accent']).toContain('var(--accent)')
    expect(dark['--reader-accent']).not.toBe('var(--accent)')
    expect(dark['--reader-panel-shadow']).not.toBe(light['--reader-panel-shadow'])
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

describe('night toggle', () => {
  it('knows which reader themes are dark', () => {
    expect(isDarkReaderTheme('night')).toBe(true)
    expect(isDarkReaderTheme('dark')).toBe(true)
    expect(isDarkReaderTheme('indigo')).toBe(false)
    expect(isDarkReaderTheme('light-blue')).toBe(false)
  })

  it('switches light themes to 夜间 and dark themes back to 靛青', () => {
    expect(nightToggleTheme('light-blue')).toBe('night')
    expect(nightToggleTheme('indigo')).toBe('night')
    expect(nightToggleTheme('night')).toBe('indigo')
    expect(nightToggleTheme('dark')).toBe('indigo')
  })
})

describe('migrateReaderTheme', () => {
  const themes = {
    indigo: { backgroundColor: '#ffffff', fontColor: '#1a2440', label: '靛青' },
    night: { backgroundColor: '#0b1020', fontColor: '#c9d3ea', label: '夜间' },
  }

  it('moves a removed theme (e.g. 护眼绿) to 靛青 with its colours', () => {
    const s = { theme: 'green-paper', backgroundColor: '#E0EEE1', fontColor: 'rgba(0,0,0,.9)', fontSize: 22 }
    expect(migrateReaderTheme(s, themes)).toEqual({ theme: 'indigo', backgroundColor: '#ffffff', fontColor: '#1a2440', fontSize: 22 })
  })

  it('keeps a known theme untouched', () => {
    const s = { theme: 'night', backgroundColor: '#0b1020', fontColor: '#c9d3ea' }
    expect(migrateReaderTheme(s, themes)).toBe(s)
  })
})

describe('isImagePage', () => {
  it('is true for a page that only holds images (manga EPUB)', () => {
    expect(isImagePage('<div>\n  <img style="width:1200px;height:1629px" src="/a.jpeg" width="745" height="1200">\n</div>')).toBe(true)
    expect(isImagePage('<svg viewBox="0 0 745 1200"><image xlink:href="/c.jpg"></image></svg>')).toBe(true)
  })

  it('is false when the page has text, or no image at all', () => {
    expect(isImagePage('<p>第一章 开端</p><img src="/a.jpg">')).toBe(false)
    expect(isImagePage('<p>正文</p>')).toBe(false)
    expect(isImagePage('')).toBe(false)
  })
})
