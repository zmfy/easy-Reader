import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, isDarkTheme } from './theme'
import { readFileSync } from 'node:fs'

const mainCss = readFileSync(new URL('../assets/styles/main.css', import.meta.url), 'utf-8')

describe('site theme', () => {
  it('defaults to 靛青 (indigo)', () => {
    expect(DEFAULT_THEME).toBe('indigo')
  })

  it('treats the default / unset theme as light', () => {
    for (const t of ['indigo', '', undefined, null]) expect(isDarkTheme(t)).toBe(false)
  })

  it('treats 晴空 / 素纸 as light', () => {
    expect(isDarkTheme('sky')).toBe(false)
    expect(isDarkTheme('paper')).toBe(false)
  })

  it('treats the three night themes as dark', () => {
    for (const t of ['dark', 'warm', 'cool']) expect(isDarkTheme(t)).toBe(true)
  })

  // 未定义的变量会退回暗夜主题的值（浅色主题里出现深色卡片），每个主题都要写全
  it.each(['dark', 'indigo', 'warm', 'cool', 'sky', 'paper'])('theme %s defines the card / input variables', (theme) => {
    const block = mainCss.match(new RegExp(`\\[data-theme="${theme}"\\][^{]*\\{([^}]*)\\}`))?.[1] ?? ''
    for (const v of ['--bg-0', '--bg-1', '--bg-2', '--text-0', '--text-2', '--accent', '--card-bg', '--card-border', '--card-title', '--input-bg']) {
      expect(block, `${theme} 缺少 ${v}`).toContain(`${v}:`)
    }
  })
})
