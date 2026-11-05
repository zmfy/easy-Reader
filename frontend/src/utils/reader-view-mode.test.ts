import { describe, it, expect } from 'vitest'
import { openingProgressMode, canSaveProgress, exitViewOnly } from './reader-view-mode'

describe('reader-view-mode', () => {
  it('enters view-only only for a valid jump target', () => {
    expect(openingProgressMode(true)).toBe('view-only')
    expect(openingProgressMode(false)).toBe('normal')
  })

  it('allows saving progress only in normal mode', () => {
    expect(canSaveProgress('normal')).toBe(true)
    expect(canSaveProgress('view-only')).toBe(false)
  })

  it('exiting view-only either saves here or restores the saved progress', () => {
    expect(exitViewOnly('continue-here')).toEqual({ mode: 'normal', saveCurrent: true, restoreSaved: false })
    expect(exitViewOnly('back-to-saved')).toEqual({ mode: 'normal', saveCurrent: false, restoreSaved: true })
  })
})
