import { describe, it, expect } from 'vitest'
import { buildTocTree, visibleTocRows, tocAncestors } from './toc-tree'

const ch = (index: number, level?: number) => ({ index, title: `c${index}`, level })

// 0 书A ┬ 1 序
//       └ 2 正编 ┬ 3 篇1
//                └ 4 篇2
// 5 书B ─ 6 篇3
const BOOK = [ch(0, 0), ch(1, 1), ch(2, 1), ch(3, 2), ch(4, 2), ch(5, 0), ch(6, 1)]

describe('buildTocTree', () => {
  it('computes depth, parent and children from levels', () => {
    const t = buildTocTree(BOOK)
    expect(t.map(n => n.depth)).toEqual([0, 1, 1, 2, 2, 0, 1])
    expect(t.map(n => n.parent)).toEqual([null, 0, 0, 2, 2, null, 5])
    expect(t[2].children).toEqual([3, 4])
    expect(t.hasNesting).toBe(true)
  })

  it('treats chapters without level as a flat list', () => {
    const t = buildTocTree([ch(0), ch(1), ch(2)])
    expect(t.map(n => n.depth)).toEqual([0, 0, 0])
    expect(t.hasNesting).toBe(false)
  })

  it('handles level jumps and a list that does not start at level 0', () => {
    // 1 → 3 → 2 → 1：跳级的子项挂到最近的上层
    const t = buildTocTree([ch(0, 1), ch(1, 3), ch(2, 2), ch(3, 1)])
    expect(t.map(n => n.depth)).toEqual([0, 1, 1, 0])
    expect(t.map(n => n.parent)).toEqual([null, 0, 0, null])
  })
})

describe('tocAncestors', () => {
  it('returns all ancestors of a chapter', () => {
    expect(tocAncestors(buildTocTree(BOOK), 4)).toEqual([2, 0])
    expect(tocAncestors(buildTocTree(BOOK), 5)).toEqual([])
  })
})

describe('visibleTocRows', () => {
  const tree = buildTocTree(BOOK)
  it('shows only top level when nothing is expanded', () => {
    expect(visibleTocRows(tree, new Set(), false).map(r => r.index)).toEqual([0, 5])
  })

  it('shows children of expanded nodes only', () => {
    const rows = visibleTocRows(tree, new Set([0, 2]), false)
    expect(rows.map(r => r.index)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rows.find(r => r.index === 2)).toMatchObject({ depth: 1, hasChildren: true, expanded: true })
    expect(rows.find(r => r.index === 5)).toMatchObject({ hasChildren: true, expanded: false })
  })

  it('reverses siblings at every level, parents stay above their children', () => {
    expect(visibleTocRows(tree, new Set([0, 2, 5]), true).map(r => r.index)).toEqual([5, 6, 0, 2, 4, 3, 1])
  })

  it('flat list keeps original behaviour, including reverse', () => {
    const flat = buildTocTree([ch(0), ch(1), ch(2)])
    expect(visibleTocRows(flat, new Set(), true).map(r => r.index)).toEqual([2, 1, 0])
  })
})

describe('group rows that are not chapters (TXT「第一部 小丑」)', () => {
  // 0 前言(0)  [第一部]{1 章(1), 2 章(1)}  [第二部]{3 章(1)}
  const CH = [
    { index: 0, title: '前言', level: 0 },
    { index: 1, title: '第一章', level: 1, groupTitle: '第一部 小丑' },
    { index: 2, title: '第二章', level: 1 },
    { index: 3, title: '第三章', level: 1, groupTitle: '第二部 无面人' },
  ]
  const tree = buildTocTree(CH)

  it('inserts a group node with a negative key above the chapter that starts it', () => {
    expect(visibleTocRows(tree, new Set(), false).map(r => [r.index, r.title])).toEqual([[0, undefined], [-1, '第一部 小丑'], [-2, '第二部 无面人']])
  })

  it('chapters inside a group have the group as ancestor', () => {
    expect(tocAncestors(tree, 2)).toEqual([-1])
    expect(visibleTocRows(tree, new Set([-1]), false).map(r => r.index)).toEqual([0, -1, 1, 2, -2])
  })
})
