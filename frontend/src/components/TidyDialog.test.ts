// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises, config } from '@vue/test-utils'
import TidyDialog from './TidyDialog.vue'
import type { DocNode } from '../types/study'

vi.mock('@/api/study', () => ({ studyApi: { tidy: vi.fn() } }))
import { studyApi } from '@/api/study'
const tidy = studyApi.tidy as unknown as ReturnType<typeof vi.fn>

config.global.stubs = { ...config.global.stubs, BubbleMenu: true, teleport: true }

const A = { colspan: 1, rowspan: 1, colwidth: null }
const tp = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const row = (type: string, cells: string[]): DocNode => ({ type: 'tableRow', content: cells.map(c => ({ type, attrs: { ...A }, content: [tp(c)] })) })
function tableOf(cols: string[], rows: number): DocNode {
  return { type: 'table', content: [row('tableHeader', cols), ...Array.from({ length: rows }, (_, i) => row('tableCell', cols.map(c => c + i)))] }
}
const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } })
const content = [tp('ls 列目录'), tp('chmod 改权限')]

const mountDialog = (mode: 'list' | 'table' = 'table') =>
  mount(TidyDialog, { props: { modelValue: false, bookId: 'b1', mode, content }, attachTo: document.body })

async function open(w: ReturnType<typeof mountDialog>) {
  await w.setProps({ modelValue: true })
  await flushPromises()
}

const button = (w: ReturnType<typeof mountDialog>, text: string) => w.findAll('button').find(b => b.text().trim() === text)!

describe('TidyDialog', () => {
  beforeEach(() => tidy.mockReset())

  it('requests on open, shows before/after, and emits adopt with description', async () => {
    const cols = ['命令', '作用', '常用参数']
    tidy.mockReturnValue(ok({ nodes: [tableOf(cols, 5)], columns: cols, missingRefs: [], aiAddedCount: 0 }))
    const w = mountDialog()
    expect(tidy).not.toHaveBeenCalled()
    await open(w)
    expect(tidy).toHaveBeenCalledWith('b1', { mode: 'table', content })
    expect(w.text()).toContain('AI 整理成表格')
    expect(w.text()).toContain('改前')
    expect(w.text()).toContain('改后')
    expect(w.text()).toContain('chmod 改权限')
    expect(w.text()).toContain('常用参数4')
    await button(w, '采用').trigger('click')
    const [nodes, description] = w.emitted('adopt')![0] as [DocNode[], string]
    expect(nodes[0].type).toBe('table')
    expect(description).toBe('整理成表格（3 列 5 行）')
    w.unmount()
  })

  it('describes list results by item count', async () => {
    const list: DocNode = { type: 'bulletList', content: ['一', '二', '三'].map(x => ({ type: 'listItem', content: [tp(x)] })) }
    tidy.mockReturnValue(ok({ nodes: [list], columns: [], missingRefs: [], aiAddedCount: 0 }))
    const w = mountDialog('list')
    await open(w)
    expect(w.text()).toContain('AI 整理成列表')
    expect(w.find('.td-columns').exists()).toBe(false)
    await button(w, '采用').trigger('click')
    expect((w.emitted('adopt')![0] as unknown[])[1]).toBe('整理成列表（3 项）')
    w.unmount()
  })

  it('re-tidies with edited column names', async () => {
    tidy.mockReturnValue(ok({ nodes: [tableOf(['甲', '乙'], 1)], columns: ['甲', '乙'], missingRefs: [], aiAddedCount: 0 }))
    const w = mountDialog()
    await open(w)
    const inputs = w.findAll('.td-columns input')
    expect(inputs).toHaveLength(2)
    await inputs[1].setValue('作用')
    await button(w, '重新整理').trigger('click')
    await flushPromises()
    expect(tidy).toHaveBeenCalledTimes(2)
    expect(tidy.mock.calls[1][1]).toEqual({ mode: 'table', content, columns: ['甲', '作用'] })
    w.unmount()
  })

  it('shows missing refs and AI addition notices', async () => {
    tidy.mockReturnValue(ok({ nodes: [tableOf(['甲', '乙'], 1)], columns: ['甲', '乙'], missingRefs: ['h:1', 'h:2'], aiAddedCount: 3 }))
    const w = mountDialog()
    await open(w)
    expect(w.text()).toContain('有 2 处原文出处没有保留，可重新整理')
    expect(w.text()).toContain('含 3 处 AI 补充')
    w.unmount()
  })

  it('shows error with retry on 422 AI_BAD_OUTPUT', async () => {
    tidy.mockReturnValueOnce(Promise.reject({ response: { status: 422, data: { code: 'AI_BAD_OUTPUT', message: 'AI 返回的内容无法解析，请重试' } } }))
    const w = mountDialog()
    await open(w)
    expect(w.text()).toContain('AI 返回的内容无法解析，请重试')
    expect(button(w, '采用').attributes('disabled')).toBeDefined()
    tidy.mockReturnValueOnce(ok({ nodes: [tableOf(['甲', '乙'], 1)], columns: ['甲', '乙'], missingRefs: [], aiAddedCount: 0 }))
    await button(w, '重试').trigger('click')
    await flushPromises()
    expect(tidy).toHaveBeenCalledTimes(2)
    expect(button(w, '采用').attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('emits close on 放弃 without adopting', async () => {
    tidy.mockReturnValue(ok({ nodes: [tableOf(['甲', '乙'], 1)], columns: ['甲', '乙'], missingRefs: [], aiAddedCount: 0 }))
    const w = mountDialog()
    await open(w)
    await button(w, '放弃').trigger('click')
    expect(w.emitted('update:modelValue')!.at(-1)).toEqual([false])
    expect(w.emitted('adopt')).toBeUndefined()
    w.unmount()
  })
})
