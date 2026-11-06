/**
 * 总导图数据组装：书的目录骨架 + 划线/导图节点 → 一棵树；以及 Markdown 大纲导出。
 * 骨架节点（书、分组、章节、未归类）不入库，只在前端拼出来。
 */
import type { Highlight, MindNode } from '../types'
import { buildTocTree } from './toc-tree'

export type MapNodeType = 'book' | 'group' | 'chapter' | 'orphans' | 'mind'

export interface MapNode {
  /** book: 'book'；group: 'g:<index>'；chapter: 'c:<index>'；orphans: 'orphans'；mind: 节点 id */
  id: string
  type: MapNodeType
  label: string
  kind?: MindNode['kind']
  node?: MindNode
  highlight?: Highlight
  chapterIndex?: number
  /** 本节点或子孙中有 mind 节点 */
  hasNotes: boolean
  children: MapNode[]
}

const HIGHLIGHT_LABEL_MAX = 30

const bySortThenCreated = (a: MindNode, b: MindNode) =>
  a.sort - b.sort || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)

export function buildBookMap(input: {
  bookTitle: string
  chapters: Array<{ index: number; title: string; level?: number; groupTitle?: string }>
  nodes: MindNode[]
  highlights: Highlight[]
}): MapNode {
  const { chapters, nodes, highlights } = input
  const root: MapNode = { id: 'book', type: 'book', label: input.bookTitle, hasNotes: false, children: [] }
  // 没有目录（浏览器原生打开的 PDF）：书根充当唯一的「章节」，节点按第 0 章添加并挂在书根下
  const noToc = chapters.length === 0
  if (noToc) root.chapterIndex = 0

  // 目录骨架：分组行（负 index）→ group，其余 → chapter
  const tree = buildTocTree(chapters)
  const titleOf = new Map(chapters.map(c => [c.index, c.title]))
  const skeleton = new Map<number, MapNode>()
  for (const t of tree) {
    skeleton.set(t.index, t.index < 0
      ? { id: `g:${t.index}`, type: 'group', label: t.title ?? '', hasNotes: false, children: [] }
      : { id: `c:${t.index}`, type: 'chapter', label: titleOf.get(t.index) ?? '', chapterIndex: t.index, hasNotes: false, children: [] })
  }

  // mind 节点；同级按 sort、created_at 排序（先排序再依次挂载即可）
  const highlightById = new Map(highlights.map(h => [h.id, h]))
  const mindById = new Map<string, MapNode>()
  for (const n of nodes) {
    const hl = n.kind === 'highlight' && n.highlight_id ? highlightById.get(n.highlight_id) : undefined
    mindById.set(n.id, {
      id: n.id,
      type: 'mind',
      label: hl ? Array.from(hl.text).slice(0, HIGHLIGHT_LABEL_MAX).join('') : n.label,
      kind: n.kind,
      node: n,
      ...(hl ? { highlight: hl } : {}),
      chapterIndex: n.chapter_index,
      hasNotes: true,
      children: [],
    })
  }
  const orphans: MapNode = { id: 'orphans', type: 'orphans', label: '未归类', hasNotes: true, children: [] }
  // 父链成环（a→b→a，或挂在环下面）的节点从根走不到，统一放进未归类，避免丢失
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const cyclic = (n: MindNode): boolean => {
    const seen = new Set<string>()
    let cur: MindNode | undefined = n
    while (cur && cur.parent_id) {
      if (seen.has(cur.id)) return true
      seen.add(cur.id)
      cur = nodeById.get(cur.parent_id)
    }
    return false
  }
  for (const n of [...nodes].sort(bySortThenCreated)) {
    const self = mindById.get(n.id)!
    const parent = n.parent_id
      ? mindById.get(n.parent_id)
      : noToc ? root : skeleton.get(n.chapter_index)
    // 父缺失（或章节不在当前目录，或章节序号落在分组行上）、父链成环 → 未归类
    const target = !cyclic(n) && parent && parent !== self && (n.parent_id || parent.type === 'chapter' || parent === root) ? parent : orphans
    target.children.push(self)
  }

  // 骨架挂载：章节自己的 mind 节点已在 children 里，子章节追加在其后
  for (const t of tree) {
    const holder = t.parent === null ? root : skeleton.get(t.parent)!
    holder.children.push(skeleton.get(t.index)!)
  }
  if (orphans.children.length) root.children.push(orphans)

  const mark = (n: MapNode): boolean => {
    n.hasNotes = n.type === 'mind' || n.children.map(mark).some(Boolean)
    return n.hasNotes
  }
  mark(root)
  return root
}

/** 去掉 hasNotes 为假的 group/chapter 分支（根保留） */
export function pruneEmpty(root: MapNode): MapNode {
  const prune = (n: MapNode): MapNode => ({
    ...n,
    children: n.children.filter(c => c.hasNotes || (c.type !== 'group' && c.type !== 'chapter')).map(prune),
  })
  return prune(root)
}

const escapeMd = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/([\\*_#[\]`])/g, '\\$1')

/** 缩进 Markdown 大纲：根为 `# 书名`，其余每层 `- ` 前缩进两个空格 */
export function toMarkdown(root: MapNode): string {
  const lines = [`# ${escapeMd(root.label)}`]
  const walk = (n: MapNode, depth: number) => {
    const pad = '  '.repeat(depth)
    // 划线节点：输出完整划线原文（导图上的标签是截断的）
    let text = escapeMd(n.highlight ? n.highlight.text : n.label)
    const m = n.node
    if (m?.summary) text += `：${escapeMd(m.summary)}`
    lines.push(`${pad}- ${text}`)
    // 划线批注在前，节点笔记在后，每行一条引用；划线节点只用划线批注（与界面一致）
    const notes = m?.kind === 'highlight' ? [n.highlight?.note] : [n.highlight?.note, m?.note]
    for (const note of notes) {
      if (note) for (const l of note.split(/\r?\n/)) if (l.trim()) lines.push(`${pad}  > ${l.trim()}`)
    }
    for (const c of n.children) walk(c, depth + 1)
  }
  for (const c of root.children) walk(c, 0)
  return lines.join('\n') + '\n'
}

/** 去掉 \ / : * ? " < > | 与首尾空白，空则「学习导图」 */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim() || '学习导图'
}

/** 按 id 在树中查找节点，找不到返回 null */
export function findMapNode(root: MapNode, id: string): MapNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const f = findMapNode(c, id)
    if (f) return f
  }
  return null
}

/** 子树中（不含自身）mind 节点的个数，用于删除确认 */
export function countMindDescendants(n: MapNode): number {
  return n.children.reduce((sum, c) => sum + (c.type === 'mind' ? 1 : 0) + countMindDescendants(c), 0)
}
