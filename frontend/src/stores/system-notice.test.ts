// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/api/settings', () => ({
  settingsApi: { getUpdateStatus: vi.fn(), getAiStatus: vi.fn(), getHttps: vi.fn() },
}))
import { settingsApi } from '@/api/settings'
import { useSystemNoticeStore } from './system-notice'

const api = settingsApi as unknown as Record<'getUpdateStatus' | 'getAiStatus' | 'getHttps', ReturnType<typeof vi.fn>>
const resp = (data: unknown) => Promise.resolve({ data: { success: true, data } })

describe('system notice store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    api.getUpdateStatus.mockReturnValue(resp({ noticeEnabled: true, currentVersion: '1.2.0', newer: [] }))
    api.getAiStatus.mockReturnValue(resp({ configured: true, config_warning: null }))
  })

  it('notice store counts a certificate warning', async () => {
    api.getHttps.mockReturnValue(resp({ listening: true, port: 3443, cert: null, lastError: null, warning: 'HTTPS 证书将在 3 天后到期（a.com）' }))
    const store = useSystemNoticeStore()
    await store.load()
    expect(store.certWarning).toBe('HTTPS 证书将在 3 天后到期（a.com）')
    expect(store.count).toBe(1)
  })

  it('ignores the certificate status when it cannot be loaded', async () => {
    api.getHttps.mockReturnValue(Promise.reject(new Error('403')))
    const store = useSystemNoticeStore()
    await store.load()
    expect(store.certWarning).toBeNull()
    expect(store.count).toBe(0)
  })
})
