import { describe, it, expect } from 'vitest'
import { layoutMap, initialCollapsed, displayLabel, type LaidOutNode } from './map-layout'
import type { MapNode } from './book-map'

const node = (id: string, children: MapNode[] = [], over: Partial<MapNode> = {}): MapNode => ({
  id, type: 'mind', label: id, hasNotes: true, children, ...over,
})
// 每字 10px，固定可预期
const measure = (label: string) => label.length * 10

// book → c:0(a(a1), b) , c:1(c)
const tree = (): MapNode => node('book', [
  node('c:0', [node('a', [node('a1')]), node('b')], { type: 'chapter' }),
  node('c:1', [node('c')], { type: 'chapter' }),
], { type: 'book' })

const byId = (nodes: LaidOutNode[]) => new Map(nodes.map(n => [n.id, n]))

describe('map-layout', () => {
  it('lays out children to the right of parents', () => {
    const { nodes, width, height } = layoutMap(tree(), new Set(), measure)
    const m = byId(nodes)
    expect(nodes).toHaveLength(7)
    const root = m.get('book')!
    for (const id of ['c:0', 'c:1']) expect(m.get(id)!.x).toBeGreaterThan(root.x + root.width)
    // 同层 x 相同（按该层最大宽度对齐）
    expect(m.get('c:0')!.x).toBe(m.get('c:1')!.x)
    expect(m.get('a')!.x).toBe(m.get('b')!.x)
    expect(m.get('a')!.x).toBe(m.get('c')!.x)
    expect(m.get('a1')!.x).toBeGreaterThan(m.get('a')!.x)
    // 同层兄弟纵向分开
    expect(m.get('a')!.y).not.toBe(m.get('b')!.y)
    expect(m.get('a1')!.depth).toBe(3)
    // 宽度来自 measure
    expect(m.get('c:0')!.width).toBeGreaterThan(measure('c:0'))
    // 所有节点在内容框内
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x + n.width).toBeLessThanOrEqual(width)
      expect(n.y).toBeGreaterThan(0)
      expect(n.y).toBeLessThan(height)
    }
  })

  it('skips collapsed subtrees', () => {
    const { nodes, links } = layoutMap(tree(), new Set(['c:0']), measure)
    const m = byId(nodes)
    expect([...m.keys()].sort()).toEqual(['book', 'c', 'c:0', 'c:1'])
    expect(m.get('c:0')).toMatchObject({ collapsed: true, hasChildren: true })
    expect(m.get('c:1')).toMatchObject({ collapsed: false, hasChildren: true })
    expect(m.get('c')).toMatchObject({ collapsed: false, hasChildren: false })
    expect(links.some(l => l.from === 'c:0')).toBe(false)
  })

  it('collapsed flag is false for leaves listed in the set', () => {
    const { nodes } = layoutMap(tree(), new Set(['c']), measure)
    expect(byId(nodes).get('c')).toMatchObject({ collapsed: false, hasChildren: false })
  })

  it('links connect parent to child', () => {
    const { nodes, links } = layoutMap(tree(), new Set(), measure)
    const m = byId(nodes)
    expect(links).toHaveLength(6)
    const l = links.find(l => l.to === 'a1')!
    expect(l.from).toBe('a')
    const p = m.get('a')!, c = m.get('a1')!
    // 水平三次贝塞尔：从父节点右缘到子节点左缘
    expect(l.path).toMatch(/^M[\d.\-]+,[\d.\-]+C/)
    expect(l.path.startsWith(`M${p.x + p.width},${p.y}C`)).toBe(true)
    expect(l.path.endsWith(`${c.x},${c.y}`)).toBe(true)
  })

  it('initialCollapsed collapses from the given depth', () => {
    const set = initialCollapsed(tree(), 2)
    // 深度 2 且有子节点的只有 a；叶子 b、c 不进集合；深度 1 的章节保持展开
    expect([...set]).toEqual(['a'])
    expect(initialCollapsed(tree(), 1)).toEqual(new Set(['c:0', 'c:1', 'a']))
    expect(initialCollapsed(tree(), 5).size).toBe(0)
  })

  it('handles a lone root', () => {
    const { nodes, links } = layoutMap(node('book', [], { type: 'book' }), new Set(), measure)
    expect(nodes).toHaveLength(1)
    expect(links).toHaveLength(0)
  })

  it('displayLabel truncates long labels and measure gets the displayed text', () => {
    const long = 'x'.repeat(40)
    expect(displayLabel(long)).toBe('x'.repeat(24) + '…')
    expect(displayLabel('短')).toBe('短')
    const seen: string[] = []
    layoutMap(node('r', [node('m', [], { label: long })]), new Set(), l => { seen.push(l); return 10 })
    expect(seen).toContain(displayLabel(long))
  })
})
