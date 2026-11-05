import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({ status: vi.fn(), add: vi.fn(), remove: vi.fn() }))
const msg = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('@/api/shelf', () => ({ shelfApi: api }))
vi.mock('element-plus', () => ({ ElMessage: msg }))

import { useShelfToggle } from './useShelfToggle'

const httpError = (status: number, message = '') => Object.assign(new Error('x'), { response: { status, data: { message } } })

beforeEach(() => { vi.clearAllMocks() })

describe('useShelfToggle', () => {
  it('loads the current status', async () => {
    api.status.mockResolvedValue({ data: { data: { inShelf: true } } })
    const s = useShelfToggle(() => 'b1')
    await s.refresh()
    expect(api.status).toHaveBeenCalledWith('b1')
    expect(s.onShelf.value).toBe(true)
  })

  it('treats a failed status request as not on shelf', async () => {
    api.status.mockRejectedValue(httpError(500))
    const s = useShelfToggle(() => 'b1')
    await s.refresh()
    expect(s.onShelf.value).toBe(false)
  })

  it('adds, then removes on the next toggle', async () => {
    api.add.mockResolvedValue({})
    api.remove.mockResolvedValue({})
    const s = useShelfToggle(() => 'b1')
    await s.toggle()
    expect(api.add).toHaveBeenCalledWith('b1')
    expect(s.onShelf.value).toBe(true)
    expect(msg.success).toHaveBeenLastCalledWith('已加入书架')
    await s.toggle()
    expect(api.remove).toHaveBeenCalledWith('b1')
    expect(s.onShelf.value).toBe(false)
    expect(msg.success).toHaveBeenLastCalledWith('已移出书架')
  })

  it('syncs to on-shelf when the book was already added elsewhere (409)', async () => {
    api.add.mockRejectedValue(httpError(409, '书籍已在书架中'))
    const s = useShelfToggle(() => 'b1')
    await s.toggle()
    expect(s.onShelf.value).toBe(true)
    expect(msg.error).not.toHaveBeenCalled()
  })

  it('syncs to off-shelf when it was already removed elsewhere (404)', async () => {
    api.remove.mockRejectedValue(httpError(404))
    const s = useShelfToggle(() => 'b1')
    s.onShelf.value = true
    await s.toggle()
    expect(s.onShelf.value).toBe(false)
    expect(msg.info).toHaveBeenCalledWith('该书已不在书架中')
  })

  it('reports other failures and keeps the state', async () => {
    api.add.mockRejectedValue(httpError(500))
    const s = useShelfToggle(() => 'b1')
    await s.toggle()
    expect(s.onShelf.value).toBe(false)
    expect(msg.error).toHaveBeenCalledWith('添加失败')
    expect(s.busy.value).toBe(false)
  })
})
