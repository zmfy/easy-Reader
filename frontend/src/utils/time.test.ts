import { describe, it, expect } from 'vitest'
import { parseServerTime, relativeTime } from './time'

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

describe('relativeTime', () => {
  const now = new Date('2026-11-10T12:00:00Z')
  it('按距今长短显示', () => {
    expect(relativeTime('2026-11-10 11:59:30', now)).toBe('刚刚')
    expect(relativeTime('2026-11-10 11:54:30.250', now)).toBe('5 分钟前')
    expect(relativeTime('2026-11-10 09:00:00', now)).toBe('3 小时前')
    expect(relativeTime('2026-11-09 10:00:00', now)).toBe('昨天')
    expect(relativeTime('2026-11-06 12:00:00', now)).toBe('4 天前')
    expect(relativeTime('2026-10-01 12:00:00', now)).toBe(new Date('2026-10-01T12:00:00Z').toLocaleDateString('zh-CN'))
  })
  it('无法解析时原样返回', () => {
    expect(relativeTime('', now)).toBe('')
    expect(relativeTime('x', now)).toBe('x')
  })
})
