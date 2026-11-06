import { describe, it, expect } from 'vitest'
import { isDismissed, dismiss } from './notice-dismiss'

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

describe('notice-dismiss', () => {
  it('normal release dismissal persists in local storage', () => {
    const local = memStorage()
    dismiss('1.2.0', false, { local, session: memStorage() })
    // 模拟新会话：sessionStorage 为空，localStorage 仍在
    expect(isDismissed('1.2.0', false, { local, session: memStorage() })).toBe(true)
  })

  it('action-required dismissal only lasts the session', () => {
    const local = memStorage()
    const session = memStorage()
    dismiss('1.2.0', true, { local, session })
    expect(isDismissed('1.2.0', true, { local, session })).toBe(true)
    expect(isDismissed('1.2.0', true, { local, session: memStorage() })).toBe(false)
  })

  it('a newer version shows again after dismissing an older one', () => {
    const store = { local: memStorage(), session: memStorage() }
    dismiss('1.2.0', false, store)
    expect(isDismissed('1.3.0', false, store)).toBe(false)
    dismiss('1.3.0', true, store)
    expect(isDismissed('1.4.0', true, store)).toBe(false)
  })
})
