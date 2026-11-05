import { describe, it, expect } from 'vitest'
import { buildBookMap, pruneEmpty, toMarkdown, safeFileName, type MapNode } from './book-map'
import type { Highlight, MindNode } from '../types'

const mind = (id: string, over: Partial<MindNode> = {}): MindNode => ({
  id, user_id: 'u', book_id: 'b', parent_id: null, chapter_index: 0, highlight_id: null,
  label: id, kind: 'custom', summary: null, note: null, source_chapter: null, source_paragraph: null,
  sort: 0, created_at: '2026-01-01T00:00:00Z', ...over,
})
const hl = (id: string, text: string, chapter = 0): Highlight => ({
  id, user_id: 'u', book_id: 'b', chapter_index: chapter, start_offset: 0, end_offset: text.length,
  text, note: null, created_at: '', updated_at: '',
})
const flat = [0, 1, 2].map(i => ({ index: i, title: `第${i}章` }))
const ids = (n: MapNode) => n.children.map(c => c.id)

describe('book-map', () => {
  it('builds skeleton from flat chapters', () => {
    const root = buildBookMap({ bookTitle: '书', chapters: flat, nodes: [], highlights: [] })
    expect(root.id).toBe('book')
    expect(root.label).toBe('书')
    expect(ids(root)).toEqual(['c:0', 'c:1', 'c:2'])
    expect(root.hasNotes).toBe(false)
  })

  it('builds nested skeleton with groups and level jumps', () => {
    // 分组行 level -1，章节 1 level 0：分组在章节 1 之前、比它高一层
    const grouped = [
      { index: 0, title: '序', level: 1 },
      { index: 1, title: '一', level: 1, groupTitle: '第一部' },
      { index: 2, title: '二', level: 1 },
      { index: 3, title: '二之一', level: 2 },
      { index: 4, title: '深', level: 4 },
    ]
    const root = buildBookMap({ bookTitle: '书', chapters: grouped, nodes: [], highlights: [] })
    expect(ids(root)).toEqual(['c:0', 'g:-1'])
    const g = root.children[1]
    expect(g.type).toBe('group')
    expect(g.label).toBe('第一部')
    expect(ids(g)).toEqual(['c:1', 'c:2'])
    const c2 = g.children[1]
    expect(c2.type).toBe('chapter')
    expect(ids(c2)).toEqual(['c:3'])
    expect(ids(c2.children[0])).toEqual(['c:4'])
  })

  it('attaches highlight roots under their chapter and children under parents', () => {
    const nodes = [
      mind('b', { chapter_index: 1, sort: 2 }),
      mind('h', { chapter_index: 1, kind: 'highlight', highlight_id: 'x', sort: 1 }),
      mind('k', { chapter_index: 1, parent_id: 'h', kind: 'event' }),
    ]
    const long = '甲'.repeat(40)
    const root = buildBookMap({ bookTitle: '书', chapters: flat, nodes, highlights: [hl('x', long, 1)] })
    const c1 = root.children[1]
    expect(ids(c1)).toEqual(['h', 'b'])
    expect(c1.children[0].label).toBe('甲'.repeat(30))
    expect(c1.children[0].highlight?.id).toBe('x')
    expect(ids(c1.children[0])).toEqual(['k'])
    expect(c1.children[0].children[0].node?.id).toBe('k')
  })

  it('puts mind nodes before sub-chapters', () => {
    const chapters = [{ index: 0, title: '卷', level: 0 }, { index: 1, title: '节', level: 1 }]
    const root = buildBookMap({ bookTitle: '书', chapters, nodes: [mind('m', { chapter_index: 0 })], highlights: [] })
    expect(ids(root.children[0])).toEqual(['m', 'c:1'])
  })

  it('puts orphans under 未归类', () => {
    const nodes = [mind('o1', { chapter_index: 99 }), mind('o2', { chapter_index: 0, parent_id: 'gone' })]
    const root = buildBookMap({ bookTitle: '书', chapters: flat, nodes, highlights: [] })
    const last = root.children[root.children.length - 1]
    expect(last.id).toBe('orphans')
    expect(last.label).toBe('未归类')
    expect(ids(last)).toEqual(['o1', 'o2'])
    expect(buildBookMap({ bookTitle: '书', chapters: flat, nodes: [], highlights: [] }).children.some(c => c.id === 'orphans')).toBe(false)
  })

  it('puts nodes in parent cycles under 未归类 exactly once', () => {
    const nodes = [
      mind('a', { parent_id: 'b' }),
      mind('b', { parent_id: 'a' }),
      mind('c', { parent_id: 'a' }),
    ]
    const root = buildBookMap({ bookTitle: '书', chapters: flat, nodes, highlights: [] })
    const orphans = root.children[root.children.length - 1]
    expect(orphans.id).toBe('orphans')
    const all: string[] = []
    const walk = (n: MapNode) => { if (n.type === 'mind') all.push(n.id); n.children.forEach(walk) }
    walk(root)
    expect(all.sort()).toEqual(['a', 'b', 'c'])
    expect(orphans.children.map(c => c.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('puts a null-parent node on a group row index under 未归类', () => {
    const chapters = [{ index: 0, title: '一', level: 1, groupTitle: '部' }]
    const root = buildBookMap({ bookTitle: '书', chapters, nodes: [mind('g', { chapter_index: -1 })], highlights: [] })
    expect(ids(root.children[root.children.length - 1])).toEqual(['g'])
    expect(root.children[root.children.length - 1].id).toBe('orphans')
  })

  it('falls back to node.label when the highlight row is missing', () => {
    const nodes = [mind('h', { kind: 'highlight', highlight_id: 'nope', label: '原标签' })]
    const root = buildBookMap({ bookTitle: '书', chapters: flat, nodes, highlights: [] })
    expect(root.children[0].children[0].label).toBe('原标签')
  })

  it('marks hasNotes up the ancestors and pruneEmpty keeps only noted branches', () => {
    const chapters = [
      { index: 0, title: '序' },
      { index: 1, title: '一', groupTitle: '部A', level: 1 },
      { index: 2, title: '二', groupTitle: '部B', level: 1 },
    ]
    const root = buildBookMap({ bookTitle: '书', chapters, nodes: [mind('m', { chapter_index: 2 })], highlights: [] })
    expect(root.hasNotes).toBe(true)
    const pruned = pruneEmpty(root)
    expect(ids(pruned)).toEqual(['g:-2'])
    expect(ids(pruned.children[0])).toEqual(['c:2'])
    expect(ids(pruned.children[0].children[0])).toEqual(['m'])
    // 无任何笔记：只剩根
    expect(pruneEmpty(buildBookMap({ bookTitle: '书', chapters: flat, nodes: [], highlights: [] })).children).toEqual([])
  })

  it('toMarkdown nests and escapes', () => {
    const nodes = [
      mind('a', { chapter_index: 0, label: '有*星#号\n换行', summary: '概述_x', note: '第一行\n第二行' }),
      mind('b', { chapter_index: 0, parent_id: 'a', label: '子' }),
    ]
    const root = buildBookMap({ bookTitle: '书[1]', chapters: flat.slice(0, 1), nodes, highlights: [] })
    expect(toMarkdown(root)).toBe(
      ['# 书\\[1\\]', '- 第0章', '  - 有\\*星\\#号 换行：概述\\_x', '    > 第一行', '    > 第二行', '    - 子', ''].join('\n'))
  })

  it('safeFileName strips illegal characters', () => {
    expect(safeFileName(' a/b\\c:d*e?f"g<h>i|j ')).toBe('abcdefghij')
    expect(safeFileName(' /: ')).toBe('学习导图')
  })
})
