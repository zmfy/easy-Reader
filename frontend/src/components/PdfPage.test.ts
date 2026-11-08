// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/utils/pdf', () => ({ renderPdfTextLayer: vi.fn() }))
import { renderPdfTextLayer } from '@/utils/pdf'
import PdfPage from './PdfPage.vue'

const renderText = renderPdfTextLayer as unknown as ReturnType<typeof vi.fn>

beforeAll(() => {
  // happy-dom 没有布局：给页面一个宽度，ResizeObserver 用空实现
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 })
  ;(globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} }
})

function fakeDoc() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale, scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
  }
  return { getPage: vi.fn(async () => page) } as any
}

const ok = (hasText: boolean) => ({ promise: Promise.resolve(hasText), cancel: vi.fn() })

describe('PdfPage text layer', () => {
  beforeEach(() => renderText.mockReset())

  it('renders a selectable text layer above the canvas', async () => {
    renderText.mockReturnValue(ok(true))
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 } })
    await flushPromises()
    const children = [...w.element.children].map(e => e.className)
    expect(children.indexOf('pdf-page-canvas')).toBeLessThan(children.findIndex(c => c.includes('pdf-text-layer')))
    expect(renderText.mock.calls[0][1]).toBe(w.find('.pdf-text-layer').element)
    w.unmount()
  })

  it('emits text-ready with hasText from the text layer', async () => {
    renderText.mockReturnValue(ok(true))
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 } })
    await flushPromises()
    expect(w.emitted('text-ready')![0]).toEqual([3, true])
    w.unmount()
  })

  it('emits hasText false when the text layer fails', async () => {
    renderText.mockReturnValue({ promise: Promise.reject(new Error('boom')), cancel: vi.fn() })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 } })
    await flushPromises()
    expect(w.emitted('text-ready')![0]).toEqual([3, false])
    expect(w.find('.pdf-page-error').exists()).toBe(false)
    spy.mockRestore()
    w.unmount()
  })

  it('re-emits text-ready after a re-render', async () => {
    renderText.mockReturnValueOnce(ok(true)).mockReturnValueOnce(ok(false))
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 } })
    await flushPromises()
    await w.setProps({ pageNumber: 4 })
    await flushPromises()
    expect(w.emitted('text-ready')).toEqual([[3, true], [4, false]])
    w.unmount()
  })
})

describe('PdfPage readiness and selection guard', () => {
  beforeEach(() => renderText.mockReset())

  it('marks the text layer ready only after it rendered, and clears it while re-rendering', async () => {
    let finish!: (v: boolean) => void
    renderText.mockReturnValueOnce(ok(true)).mockReturnValueOnce({ promise: new Promise<boolean>(r => { finish = r }), cancel: vi.fn() })
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 } })
    await flushPromises()
    const layer = () => w.find('.pdf-text-layer').element as HTMLElement
    expect(layer().dataset.ready).toBe('1')
    await w.setProps({ pageNumber: 4 })
    await flushPromises()
    expect(layer().dataset.ready).toBeUndefined()
    finish(false)
    await flushPromises()
    expect(layer().dataset.ready).toBe('1')
    w.unmount()
  })

  it('adds an endOfContent guard and toggles selecting during a mouse drag', async () => {
    renderText.mockReturnValue(ok(true))
    const w = mount(PdfPage, { props: { doc: fakeDoc(), pageNumber: 3 }, attachTo: document.body })
    await flushPromises()
    const layer = w.find('.pdf-text-layer').element as HTMLElement
    expect(layer.lastElementChild?.classList.contains('endOfContent')).toBe(true)
    expect(layer.textContent).toBe('')
    layer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(layer.classList.contains('selecting')).toBe(true)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(layer.classList.contains('selecting')).toBe(false)
    w.unmount()
  })
})
