// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const replace = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ replace }) }))
vi.mock('@/api/reader', () => ({ readerApi: { lastRead: vi.fn() } }))
import { readerApi } from '@/api/reader'
import ContinueReading from './ContinueReading.vue'

const lastRead = readerApi.lastRead as unknown as ReturnType<typeof vi.fn>

describe('ContinueReading', () => {
  beforeEach(() => { replace.mockReset(); lastRead.mockReset() })

  it('ContinueReading opens the last read book or falls back to the shelf', async () => {
    lastRead.mockResolvedValueOnce({ data: { success: true, data: { bookId: 'b1' } } })
    mount(ContinueReading)
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith('/reader/b1')

    lastRead.mockResolvedValueOnce({ data: { success: true, data: null } })
    mount(ContinueReading)
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith('/shelf')

    lastRead.mockRejectedValueOnce(new Error('offline'))
    mount(ContinueReading)
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith('/shelf')
  })
})
