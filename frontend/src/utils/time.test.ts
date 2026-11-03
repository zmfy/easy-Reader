import { describe, it, expect } from 'vitest'
import { parseServerTime } from './time'

describe('parseServerTime', () => {
  it('treats SQLite CURRENT_TIMESTAMP strings as UTC', () => {
    expect(parseServerTime('2026-11-03 02:00:00')?.toISOString()).toBe('2026-11-03T02:00:00.000Z')
  })
  it('keeps ISO strings with an explicit zone as-is', () => {
    expect(parseServerTime('2026-11-10T06:42:55.000Z')?.toISOString()).toBe('2026-11-10T06:42:55.000Z')
  })
  it('returns null for empty or invalid input', () => {
    expect(parseServerTime('')).toBeNull()
    expect(parseServerTime(null)).toBeNull()
    expect(parseServerTime('not a date')).toBeNull()
  })
})
