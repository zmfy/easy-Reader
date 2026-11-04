import { describe, it, expect } from 'vitest'
import { isDarkTheme } from './theme'

describe('isDarkTheme', () => {
  it('treats the three night themes and the default as dark', () => {
    for (const t of ['dark', 'warm', 'cool', '', undefined]) expect(isDarkTheme(t)).toBe(true)
  })

  it('treats 晴空 / 素纸 as light', () => {
    expect(isDarkTheme('sky')).toBe(false)
    expect(isDarkTheme('paper')).toBe(false)
  })
})
