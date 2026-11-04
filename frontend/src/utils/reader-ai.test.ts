import { describe, it, expect } from 'vitest'
import { daysSince, shouldOfferRecap, awayLabel, askHistory, type AskMessage } from './reader-ai'

const NOW = new Date('2026-11-10T12:00:00Z')

describe('daysSince', () => {
  it('counts whole days since an SQLite UTC timestamp', () => {
    expect(daysSince('2026-11-05 11:00:00', NOW)).toBe(5)
    expect(daysSince('2026-11-10 08:00:00', NOW)).toBe(0)
  })

  it('returns null for missing or invalid time', () => {
    expect(daysSince(null, NOW)).toBeNull()
    expect(daysSince('not a time', NOW)).toBeNull()
  })
})

describe('shouldOfferRecap', () => {
  it('offers a recap after 3 or more days away when AI is ready', () => {
    expect(shouldOfferRecap({ hasProgress: true, updatedAt: '2026-11-07 11:00:00' }, true, NOW)).toBe(true)
  })

  it('does not offer it for recent reading, a new book, or without AI', () => {
    expect(shouldOfferRecap({ hasProgress: true, updatedAt: '2026-11-08 13:00:00' }, true, NOW)).toBe(false)
    expect(shouldOfferRecap({ hasProgress: false, updatedAt: null }, true, NOW)).toBe(false)
    expect(shouldOfferRecap({ hasProgress: true, updatedAt: '2026-10-01 00:00:00' }, false, NOW)).toBe(false)
  })
})

describe('awayLabel', () => {
  it('describes how long ago in Chinese', () => {
    expect(awayLabel(0)).toBe('今天')
    expect(awayLabel(1)).toBe('昨天')
    expect(awayLabel(5)).toBe('5 天前')
    expect(awayLabel(45)).toBe('1 个多月前')
    expect(awayLabel(400)).toBe('1 年多前')
  })
})

describe('askHistory', () => {
  it('pairs answered questions and keeps only the last 3, skipping errors and pending ones', () => {
    const msgs: AskMessage[] = [
      { role: 'user', text: 'q1' }, { role: 'ai', text: 'a1' },
      { role: 'user', text: 'q2' }, { role: 'ai', text: '出错了', error: true },
      { role: 'user', text: 'q3' }, { role: 'ai', text: 'a3' },
      { role: 'user', text: 'q4' }, { role: 'ai', text: 'a4' },
      { role: 'user', text: 'q5' }, { role: 'ai', text: 'a5' },
      { role: 'user', text: 'q6' }, { role: 'ai', text: '', pending: true },
    ]
    expect(askHistory(msgs)).toEqual([{ q: 'q3', a: 'a3' }, { q: 'q4', a: 'a4' }, { q: 'q5', a: 'a5' }])
  })
})
