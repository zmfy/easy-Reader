import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
})

const refreshMock = vi.fn()
vi.mock('@/api/auth', () => ({ authApi: { refresh: (t: string) => refreshMock(t) } }))

import { useAuthStore } from './auth'

const axiosError = (status?: number) => Object.assign(new Error('request failed'), {
  isAxiosError: true,
  response: status ? { status } : undefined,
})

describe('auth store tryRefresh', () => {
  beforeEach(() => {
    store.clear()
    store.set('refreshToken', 'old-refresh')
    refreshMock.mockReset()
    setActivePinia(createPinia())
  })

  it('logs out when the server rejects the refresh token (401)', async () => {
    refreshMock.mockRejectedValue(axiosError(401))
    expect(await useAuthStore().tryRefresh()).toBe(false)
    expect(store.get('refreshToken')).toBeUndefined()
  })

  it.each([
    ['network error', undefined],
    ['server error', 503],
    ['rate limited', 429],
  ])('keeps the session on a transient failure (%s)', async (_label, status) => {
    refreshMock.mockRejectedValue(axiosError(status))
    expect(await useAuthStore().tryRefresh()).toBe(false)
    expect(store.get('refreshToken')).toBe('old-refresh')
  })
})
