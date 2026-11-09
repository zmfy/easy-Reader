import { describe, it, expect } from 'vitest'
import { readerPalette, isEinkTheme, nightToggleTheme } from './reader-style'
import { tapZoneAction } from './reader-keys'
import { themes } from '@/stores/reader'

describe('e-ink reader theme', () => {
  it('is listed as a reader theme with pure black on white', () => {
    expect(themes.eink).toEqual({ backgroundColor: '#ffffff', fontColor: '#000000', label: '墨水屏' })
    expect(isEinkTheme('eink')).toBe(true)
    expect(isEinkTheme('indigo')).toBe(false)
    expect(nightToggleTheme('eink')).toBe('night')
  })

  it('uses only solid colors: no color-mix, transparency or shadows', () => {
    const p = readerPalette('eink', '#ffffff', '#000000', '#4338ca')
    expect(p['--reader-text']).toBe('#000000')
    expect(p['--reader-paper-bg']).toBe('#ffffff')
    expect(p['--reader-panel-shadow']).toBe('none')
    for (const v of Object.values(p)) {
      expect(v).not.toMatch(/color-mix|rgba|var\(/)
    }
  })
})

describe('tapZoneAction', () => {
  it('maps left / middle / right of the screen', () => {
    expect(tapZoneAction(0, 1000)).toBe('pageUp')
    expect(tapZoneAction(299, 1000)).toBe('pageUp')
    expect(tapZoneAction(300, 1000)).toBe('toggle')
    expect(tapZoneAction(699, 1000)).toBe('toggle')
    expect(tapZoneAction(700, 1000)).toBe('pageDown')
    expect(tapZoneAction(1000, 1000)).toBe('pageDown')
    expect(tapZoneAction(10, 0)).toBe('toggle')
  })
})
