import { describe, it, expect, vi, beforeEach } from 'vitest'

const api = vi.hoisted(() => ({
  getChapterContent: vi.fn(),
  saveProgress: vi.fn(),
  saveProgressOnHide: vi.fn(),
}))
vi.mock('@/api/reader', () => ({ readerApi: api }))
vi.mock('element-plus', () => ({ ElMessage: { success: vi.fn() } }))

import { useReader } from './useReader'

const anchor = { paragraphIndex: 1, paragraphOffset: 0.5 }

beforeEach(() => {
  vi.clearAllMocks()
  api.getChapterContent.mockResolvedValue({ data: { data: { content: 'x' } } })
  api.saveProgress.mockResolvedValue({})
})

function readerWithChapters() {
  const r = useReader('b1')
  r.chapters.value = [0, 1, 2].map(i => ({ index: i, title: `第${i}章` })) as never
  r.currentChapterIndex.value = 1
  return r
}

describe('useReader 查看模式', () => {
  it('saves progress normally', async () => {
    const r = readerWithChapters()
    await r.saveProgress(10, anchor)
    r.saveProgressOnHide(10, anchor)
    await r.nextChapter()
    expect(api.saveProgress).toHaveBeenCalledTimes(2)
    expect(api.saveProgressOnHide).toHaveBeenCalledTimes(1)
  })

  it('never saves progress in view-only mode, but still turns pages', async () => {
    const r = readerWithChapters()
    r.progressMode.value = 'view-only'
    await r.saveProgress(10, anchor)
    r.saveProgressOnHide(10, anchor)
    await r.nextChapter()
    expect(r.currentChapterIndex.value).toBe(2)
    await r.prevChapter()
    expect(r.currentChapterIndex.value).toBe(1)
    expect(api.saveProgress).not.toHaveBeenCalled()
    expect(api.saveProgressOnHide).not.toHaveBeenCalled()
  })
})
