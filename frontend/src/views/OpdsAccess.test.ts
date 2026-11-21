// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/api/opds', () => ({ opdsApi: { status: vi.fn(), issue: vi.fn(), disable: vi.fn() } }))
vi.mock('@/layouts/DefaultLayout.vue', () => ({ default: { template: '<div><slot /></div>' } }))
import { opdsApi } from '@/api/opds'
import OpdsAccess from './OpdsAccess.vue'

const status = opdsApi.status as unknown as ReturnType<typeof vi.fn>
const issue = opdsApi.issue as unknown as ReturnType<typeof vi.fn>

const ok = <T>(data: T) => ({ data: { success: true, data } })
const disabled = { enabled: false, created_at: null, last_used_at: null, username: 'alice' }
const enabled = { enabled: true, created_at: '2026-11-21 08:00:00', last_used_at: null, username: 'alice' }

const mountPage = () => mount(OpdsAccess, {
  global: {
    stubs: {
      PageHeader: { props: ['title'], template: '<h1>{{ title }}</h1>' },
      'el-button': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
      'el-input': { props: ['modelValue'], emits: ['update:modelValue'], template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />' },
    },
  },
})

describe('OpdsAccess', () => {
  beforeEach(() => { status.mockReset(); issue.mockReset() })

  it('未开通时显示书目源地址、用户名和「开通」', async () => {
    status.mockResolvedValueOnce(ok(disabled))
    const w = mountPage()
    await flushPromises()
    expect(w.text()).toContain(`${location.origin}/opds`)
    expect(w.text()).toContain('alice')
    expect(w.findAll('button').map(b => b.text())).toContain('开通')
  })

  it('输入登录密码开通后显示一次性密码', async () => {
    status.mockResolvedValueOnce(ok(disabled))
    issue.mockResolvedValueOnce(ok({ password: 'abcdEFGH2345jkmn', username: 'alice' }))
    status.mockResolvedValueOnce(ok(enabled))
    const w = mountPage()
    await flushPromises()
    await w.find('input').setValue('Login-pass1')
    await w.findAll('button').find(b => b.text() === '开通')!.trigger('click')
    await flushPromises()
    expect(issue).toHaveBeenCalledWith('Login-pass1')
    expect(w.text()).toContain('abcdEFGH2345jkmn')
    expect(w.text()).toContain('只显示这一次')
  })

  it('链接到官网 OPDS 设置指南与各系统看书软件推荐', async () => {
    status.mockResolvedValueOnce(ok(disabled))
    const w = mountPage()
    await flushPromises()
    const link = w.findAll('a').find(a => a.attributes('href') === 'https://easyreader.ucool.uk/guides/opds-reader-apps')
    expect(link).toBeTruthy()
    expect(w.text()).toContain('看书软件推荐')
  })

  it('重新进入页面不再显示密码，已开通时可以重置和关闭', async () => {
    status.mockResolvedValueOnce(ok(enabled))
    const w = mountPage()
    await flushPromises()
    expect(w.text()).not.toContain('只显示这一次')
    const labels = w.findAll('button').map(b => b.text())
    expect(labels).toContain('重置密码')
    expect(labels).toContain('关闭')
  })
})
