import { describe, it, expect } from 'vitest'
import { DEFAULT_THEME, isDarkTheme } from './theme'

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
})
