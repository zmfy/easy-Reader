import { describe, it, expect } from 'vitest'
import type { MindNode, ExpandedCandidate } from '../types'
import { buildMindTree, chainTo, pathTo, keyMoves, type TreeNode } from './mind-tree'

let seq = 0
const node = (id: string, parent_id: string | null, label: string, extra: Partial<MindNode> = {}): MindNode => ({
  id, user_id: 'u', book_id: 'b', parent_id, chapter_index: 0, highlight_id: 'h1', label,
  kind: parent_id === null ? 'highlight' : 'event', summary: `${label}的说明`, note: null,
  source_chapter: null, source_paragraph: null, sort: 0, created_at: `2026-11-05 00:00:0${seq++ % 10}`, ...extra,
})
const cand = (label: string, kind: ExpandedCandidate['kind'] = 'concept', source: ExpandedCandidate['source'] = null): ExpandedCandidate =>
  ({ label, kind, summary: `${label}是什么`, source })

const find = (t: TreeNode, key: string): TreeNode | undefined =>
  t.key === key ? t : t.children.map(c => find(c, key)).find(Boolean)

// 已保留：根(划线) ─ A ─ B
const KEPT = [
  node('r', null, '划线原文'),
  node('a', 'r', 'A', { source_chapter: 2, source_paragraph: 5 }),
  node('b', 'a', 'B', { kind: 'person' }),
]

describe('buildMindTree', () => {
  it('builds kept nodes as solid tree', () => {
    const t = buildMindTree(KEPT, {}, '划线原文')
    expect(t.key).toBe('root')
    expect(t.kind).toBe('highlight')
    expect(t.kept).toBe(true)
    expect(t.nodeId).toBe('r')
    expect(t.children.map(c => c.key)).toEqual(['a'])
    const a = t.children[0]
    expect(a).toMatchObject({ label: 'A', kind: 'event', kept: true, nodeId: 'a', summary: 'A的说明' })
    expect(a.source).toEqual({ chapterIndex: 2, paragraphIndex: 5, chapterTitle: '', later: false })
    expect(a.children[0]).toMatchObject({ key: 'b', label: 'B', kind: 'person', kept: true, source: null })
  })

  it('marks kept sources beyond the reading boundary from source_later', () => {
    const t = buildMindTree([
      node('r', null, '划线原文'),
      node('a', 'r', 'A', { source_chapter: 9, source_paragraph: 0, source_later: true }),
    ], {}, '划线原文')
    expect(t.children[0].source).toEqual({ chapterIndex: 9, paragraphIndex: 0, chapterTitle: '', later: true })
  })

  it('returns a bare root when nothing is kept', () => {
    const t = buildMindTree([], {}, '某句话')
    expect(t).toMatchObject({ key: 'root', label: '某句话', kept: false, nodeId: null, children: [] })
  })

  it('attaches candidates under their parent and hides ones already kept', () => {
    const t = buildMindTree(KEPT, {
      root: [cand('A'), cand('C')],
      a: [cand('B'), cand('D', 'person', { chapterIndex: 1, paragraphIndex: 0, chapterTitle: '第二章', later: true })],
      'c:root/C': [cand('E')],
    }, '划线原文')
    expect(t.children.map(c => [c.key, c.kept])).toEqual([['a', true], ['c:root/C', false]])
    const a = find(t, 'a')!
    expect(a.children.map(c => c.key)).toEqual(['b', 'c:a/D'])
    expect(find(t, 'c:a/D')!.source).toMatchObject({ chapterTitle: '第二章', later: true })
    expect(find(t, 'c:root/C')!.children.map(c => c.key)).toEqual(['c:c:root/C/E'])
  })
})

describe('chainTo', () => {
  it('chainTo returns labels from root child to the node', () => {
    const t = buildMindTree(KEPT, { b: [cand('X', 'concept', { chapterIndex: 3, paragraphIndex: 1, chapterTitle: 't', later: false })] }, '划线原文')
    const chain = chainTo(t, 'c:b/X')
    expect(chain.map(c => c.label)).toEqual(['A', 'B', 'X'])
    expect(chain[0]).toEqual({ label: 'A', kind: 'event', summary: 'A的说明', source: { chapterIndex: 2, paragraphIndex: 5 } })
    expect(chain[2]).toEqual({ label: 'X', kind: 'concept', summary: 'X是什么', source: { chapterIndex: 3, paragraphIndex: 1 } })
  })

  it('returns an empty chain for the root or an unknown key', () => {
    const t = buildMindTree(KEPT, {}, '划线原文')
    expect(chainTo(t, 'root')).toEqual([])
    expect(chainTo(t, 'nope')).toEqual([])
  })
})

describe('pathTo', () => {
  it('pathTo excludes the node itself', () => {
    const t = buildMindTree(KEPT, { b: [cand('X')] }, '划线原文')
    expect(pathTo(t, 'c:b/X')).toEqual(['A', 'B'])
    expect(pathTo(t, 'a')).toEqual([])
    expect(pathTo(t, 'root')).toEqual([])
  })
})

describe('keyMoves', () => {
  it('maps candidate keys to node ids once the candidate is kept', () => {
    const before = buildMindTree(KEPT.slice(0, 1), { root: [cand('C')], 'c:root/C': [cand('E')] }, '划线原文')
    const after = buildMindTree([...KEPT.slice(0, 1), node('c', 'r', 'C')], { root: [cand('C')], 'c:root/C': [cand('E')] }, '划线原文')
    expect(keyMoves(before, after)).toEqual({ 'c:root/C': 'c', 'c:c:root/C/E': 'c:c/E' })
  })

  it('carries nested candidates along when a deep candidate is kept', () => {
    const cands = { root: [cand('C')], 'c:root/C': [cand('X'), cand('Y')], 'c:c:root/C/Y': [cand('Z')] }
    const before = buildMindTree(KEPT.slice(0, 1), cands, '划线原文')
    const after = buildMindTree([...KEPT.slice(0, 1), node('c', 'r', 'C'), node('x', 'c', 'X')], cands, '划线原文')
    expect(keyMoves(before, after)).toEqual({
      'c:root/C': 'c', 'c:c:root/C/X': 'x', 'c:c:root/C/Y': 'c:c/Y', 'c:c:c:root/C/Y/Z': 'c:c:c/Y/Z',
    })
  })

  it('drops subtrees of deleted kept nodes', () => {
    const before = buildMindTree(KEPT, { b: [cand('X')] }, '划线原文')
    const after = buildMindTree(KEPT.slice(0, 2), { b: [cand('X')] }, '划线原文')
    expect(keyMoves(before, after)).toEqual({})
  })
})
