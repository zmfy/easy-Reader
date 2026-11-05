// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import MindMapCanvas from './MindMapCanvas.vue'
import type { MapNode } from '../utils/book-map'

const mk = (id: string, type: MapNode['type'], children: MapNode[] = []): MapNode => ({ id, type, label: id, hasNotes: true, children })
const book = (chapters: number) => mk('book', 'book', Array.from({ length: chapters }, (_, i) => mk(`c:${i}`, 'chapter', [mk(`m${i}`, 'mind')])))

// happy-dom 不做布局，clientWidth/clientHeight 恒为 0：用可调的尺寸模拟画布大小
let size = { w: 800, h: 600 }
const saved = {
  w: Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth'),
  h: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight'),
}
beforeEach(() => {
  size = { w: 800, h: 600 }
  Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => size.w })
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => size.h })
})
afterEach(() => {
  if (saved.w) Object.defineProperty(Element.prototype, 'clientWidth', saved.w)
  if (saved.h) Object.defineProperty(Element.prototype, 'clientHeight', saved.h)
})

const viewportTransform = (w: ReturnType<typeof mount>) => w.find('svg > g').attributes('transform')

describe('MindMapCanvas', () => {
  it('fits on first content, then keeps the zoom when root changes', async () => {
    const w = mount(MindMapCanvas, { props: { root: book(2), selectedId: null }, attachTo: document.body })
    await nextTick()
    const first = viewportTransform(w)
    expect(first).toMatch(/^translate\(.+\) scale\(.+\)$/)
    // 内容大很多，若再 fit 结果一定不同
    await w.setProps({ root: book(80) })
    await nextTick()
    expect(viewportTransform(w)).toBe(first)
    w.unmount()
  })

  it('fits on a later root change when the first mount had no size', async () => {
    size = { w: 0, h: 0 }
    const w = mount(MindMapCanvas, { props: { root: book(2), selectedId: null }, attachTo: document.body })
    await nextTick()
    expect(viewportTransform(w)).toBeUndefined()
    size = { w: 800, h: 600 }
    await w.setProps({ root: book(3) })
    await nextTick()
    expect(viewportTransform(w)).toMatch(/scale/)
    w.unmount()
  })

  it('clicking a node selects it; clicking the toggle collapses without selecting', async () => {
    const w = mount(MindMapCanvas, { props: { root: book(2), selectedId: null }, attachTo: document.body })
    await nextTick()
    await w.findAll('.mm-node')[1].trigger('click')
    expect(w.emitted('select')).toEqual([['c:0']])
    const count = w.findAll('.mm-node').length
    await w.findAll('.mm-node')[1].find('.mm-toggle').trigger('click')
    expect(w.emitted('select')).toHaveLength(1)
    expect(w.findAll('.mm-node').length).toBe(count - 1)
    w.unmount()
  })
})
