import { describe, it, expect } from 'vitest'
import { unreadCount, markSeen } from './notice-count'

function memStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, v) },
  }
}

describe('notice-count', () => {
  it('config warnings always count', () => {
    const store = memStorage()
    expect(unreadCount({ configWarnings: 1, latestVersion: null, actionRequired: false }, store)).toBe(1)
    markSeen('1.2.0', store)
    expect(unreadCount({ configWarnings: 2, latestVersion: '1.2.0', actionRequired: false }, store)).toBe(2)
  })

  it('unseen new version counts once', () => {
    const store = memStorage()
    expect(unreadCount({ configWarnings: 0, latestVersion: '1.3.0', actionRequired: false }, store)).toBe(1)
    expect(unreadCount({ configWarnings: 1, latestVersion: '1.3.0', actionRequired: false }, store)).toBe(2)
    expect(unreadCount({ configWarnings: 0, latestVersion: null, actionRequired: false }, store)).toBe(0)
  })

  it('seen normal version stops counting until a newer one', () => {
    const store = memStorage()
    markSeen('1.2.0', store)
    expect(unreadCount({ configWarnings: 0, latestVersion: '1.2.0', actionRequired: false }, store)).toBe(0)
    expect(unreadCount({ configWarnings: 0, latestVersion: '1.3.0', actionRequired: false }, store)).toBe(1)
    expect(store.getItem('update-notice-seen')).toBe('1.2.0')
  })

  it('action-required version keeps counting after seen', () => {
    const store = memStorage()
    markSeen('1.2.0', store)
    expect(unreadCount({ configWarnings: 0, latestVersion: '1.2.0', actionRequired: true }, store)).toBe(1)
    expect(unreadCount({ configWarnings: 1, latestVersion: '1.2.0', actionRequired: true }, store)).toBe(2)
  })
})
