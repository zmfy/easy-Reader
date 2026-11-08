// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/api/settings', () => ({ settingsApi: { getHttps: vi.fn(), uploadHttps: vi.fn(), deleteHttps: vi.fn() } }))
vi.mock('element-plus', async (orig) => {
  const mod = await orig<typeof import('element-plus')>()
  return { ...mod, ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, ElMessageBox: { confirm: vi.fn() } }
})
import { settingsApi } from '@/api/settings'
import { ElMessage, ElMessageBox } from 'element-plus'
import HttpsCertCard from './HttpsCertCard.vue'

const api = settingsApi as unknown as Record<'getHttps' | 'uploadHttps' | 'deleteHttps', ReturnType<typeof vi.fn>>
const resp = (data: unknown) => Promise.resolve({ data: { success: true, data } })
const cert = { domains: ['book.example.com'], issuer: 'CN=R11', notBefore: '2026-11-01T00:00:00.000Z', notAfter: '2026-12-18T00:00:00.000Z', expired: false, notYetValid: false, daysLeft: 40 }
const on = { listening: true, port: 3443, cert, lastError: null, warning: null }
const off = { listening: false, port: 3443, cert: null, lastError: null, warning: null }

describe('HttpsCertCard', () => {
  beforeEach(() => { Object.values(api).forEach(f => f.mockReset()); vi.mocked(ElMessage.warning).mockReset(); vi.mocked(ElMessageBox.confirm).mockReset() })

  it('shows status, domains and days left', async () => {
    api.getHttps.mockReturnValue(resp(on))
    const w = mount(HttpsCertCard)
    await flushPromises()
    expect(w.text()).toContain('HTTPS 证书')
    expect(w.text()).toContain('HTTPS 已开启')
    expect(w.text()).toContain('3443')
    expect(w.text()).toContain('book.example.com')
    expect(w.text()).toContain('还有 40 天到期')
  })

  it('marks expired and not-yet-valid certificates', async () => {
    api.getHttps.mockReturnValue(resp({ ...on, cert: { ...cert, expired: true, daysLeft: -2 } }))
    const w = mount(HttpsCertCard)
    await flushPromises()
    expect(w.text()).toContain('已过期')
    api.getHttps.mockReturnValue(resp({ ...on, cert: { ...cert, notYetValid: true } }))
    const w2 = mount(HttpsCertCard)
    await flushPromises()
    expect(w2.text()).toContain('尚未生效')
  })

  it('shows the load error when HTTPS is off', async () => {
    api.getHttps.mockReturnValue(resp({ ...off, lastError: '证书与私钥不匹配' }))
    const w = mount(HttpsCertCard)
    await flushPromises()
    expect(w.text()).toContain('HTTPS 未开启')
    expect(w.text()).toContain('证书与私钥不匹配')
    expect(w.text()).toContain('也可以把 fullchain.pem 与 privkey.pem 放进数据目录的 certs 文件夹，替换后自动生效')
  })

  it('uploads pasted PEM text and surfaces warnings', async () => {
    api.getHttps.mockReturnValue(resp(off))
    api.uploadHttps.mockReturnValue(resp({ ...on, warnings: ['证书已过期'] }))
    const w = mount(HttpsCertCard)
    await flushPromises()
    const areas = w.findAll('textarea')
    await areas[0].setValue('CERT-PEM')
    await areas[1].setValue('KEY-PEM')
    await w.findAll('button').find(b => b.text().includes('上传并启用'))!.trigger('click')
    await flushPromises()
    expect(api.uploadHttps).toHaveBeenCalledWith('CERT-PEM', 'KEY-PEM')
    expect(ElMessage.warning).toHaveBeenCalledWith('证书已过期')
    expect(w.text()).toContain('HTTPS 已开启')
  })

  it('confirms before deleting the certificate', async () => {
    api.getHttps.mockReturnValue(resp(on))
    api.deleteHttps.mockReturnValue(resp(off))
    vi.mocked(ElMessageBox.confirm).mockRejectedValueOnce('cancel')
    const w = mount(HttpsCertCard)
    await flushPromises()
    const del = () => w.findAll('button').find(b => b.text().includes('删除证书'))!
    await del().trigger('click')
    await flushPromises()
    expect(api.deleteHttps).not.toHaveBeenCalled()
    vi.mocked(ElMessageBox.confirm).mockResolvedValueOnce('confirm' as never)
    await del().trigger('click')
    await flushPromises()
    expect(api.deleteHttps).toHaveBeenCalled()
    expect(w.text()).toContain('HTTPS 未开启')
  })
})
