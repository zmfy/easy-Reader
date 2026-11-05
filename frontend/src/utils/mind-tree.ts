import type { MindNode, ExpandedCandidate, ChainItem } from '../types'

/** 展开面板的树节点：根是划线本身（key 'root'），其余为已保留节点（实线）或本次展开的候选（虚线） */
export interface TreeNode {
  /** 已保留：节点 id；候选：'c:' + 父 key + '/' + label；根：'root' */
  key: string
  label: string
  kind: MindNode['kind']
  summary: string | null
  kept: boolean
  nodeId: string | null
  /** 已保留节点由 source_chapter/paragraph 与 source_later 还原（chapterTitle 留空，由调用方按目录补） */
  source: ExpandedCandidate['source']
  children: TreeNode[]
}

const byOrder = (a: MindNode, b: MindNode) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)

function keptSource(n: MindNode): ExpandedCandidate['source'] {
  if (n.source_chapter === null) return null
  return { chapterIndex: n.source_chapter, paragraphIndex: n.source_paragraph ?? 0, chapterTitle: '', later: n.source_later === true }
}

/** 已保留节点（同一划线）建树；candidates: 父 key → 本次展开的候选；与已保留子节点同 label 的候选不重复出现 */
export function buildMindTree(kept: MindNode[], candidates: Record<string, ExpandedCandidate[]>, rootLabel: string): TreeNode {
  const keptRoot = kept.find(n => n.parent_id === null) ?? null
  const childrenOf = new Map<string | null, MindNode[]>()
  for (const n of kept) {
    if (n === keptRoot) continue
    // 已保留根下的节点、以及（异常的）无父节点都挂到树根下
    const parent = n.parent_id === null || n.parent_id === keptRoot?.id ? null : n.parent_id
    const list = childrenOf.get(parent) ?? []
    list.push(n)
    childrenOf.set(parent, list)
  }

  function candidateNode(parentKey: string, c: ExpandedCandidate): TreeNode {
    const key = `c:${parentKey}/${c.label}`
    return { key, label: c.label, kind: c.kind, summary: c.summary, kept: false, nodeId: null, source: c.source, children: attach(key, []) }
  }

  // 已保留子节点在前，候选在后（与已保留子节点同名的候选跳过）
  function attach(key: string, keptChildren: TreeNode[]): TreeNode[] {
    const seen = new Set(keptChildren.map(c => c.label))
    const extra: TreeNode[] = []
    for (const c of candidates[key] ?? []) {
      if (seen.has(c.label)) continue
      seen.add(c.label)
      extra.push(candidateNode(key, c))
    }
    return [...keptChildren, ...extra]
  }

  function keptNode(n: MindNode): TreeNode {
    const kids = (childrenOf.get(n.id) ?? []).sort(byOrder).map(keptNode)
    return { key: n.id, label: n.label, kind: n.kind, summary: n.summary, kept: true, nodeId: n.id, source: keptSource(n), children: attach(n.id, kids) }
  }

  const rootKids = (childrenOf.get(null) ?? []).sort(byOrder).map(keptNode)
  return {
    key: 'root', label: rootLabel, kind: 'highlight', summary: null,
    kept: keptRoot !== null, nodeId: keptRoot?.id ?? null, source: null,
    children: attach('root', rootKids),
  }
}

/** 从根到 key 的节点序列（含根与 key 本身）；找不到为 null */
function nodesTo(tree: TreeNode, key: string): TreeNode[] | null {
  if (tree.key === key) return [tree]
  for (const c of tree.children) {
    const p = nodesTo(c, key)
    if (p) return [tree, ...p]
  }
  return null
}

/** 从根的子节点到 key 的 label/kind/summary/source 链，供 keepChain 使用 */
export function chainTo(tree: TreeNode, key: string): ChainItem[] {
  const nodes = nodesTo(tree, key)
  if (!nodes) return []
  return nodes.slice(1).map(n => ({
    label: n.label,
    kind: n.kind as ChainItem['kind'],
    ...(n.summary ? { summary: n.summary } : {}),
    source: n.source ? { chapterIndex: n.source.chapterIndex, paragraphIndex: n.source.paragraphIndex } : null,
  }))
}

/** 从根到 key 的上级 label（不含根——即划线原文——也不含 key 本身），供 expand 的 path */
export function pathTo(tree: TreeNode, key: string): string[] {
  const nodes = nodesTo(tree, key)
  if (!nodes) return []
  return nodes.slice(1, -1).map(n => n.label)
}

/**
 * 保留/删除后已保留节点变了，候选的 key（'c:' + 父 key + '/' + label）会跟着父节点变。
 * 按 label 路径对照：新树里同路径的节点用新树的 key，其余候选按新的父 key 推算；返回 旧 key → 新 key（只含变化的）。
 * after 用新的已保留节点、旧的 candidates 建树即可。被删掉的已保留节点及其子树不出现在结果里。
 */
export function keyMoves(before: TreeNode, after: TreeNode): Record<string, string> {
  const byPath = new Map<string, string>()
  const index = (n: TreeNode, path: string) => {
    byPath.set(path, n.key)
    for (const c of n.children) index(c, `${path}\u0000${c.label}`)
  }
  index(after, '')
  const moves: Record<string, string> = {}
  const walk = (n: TreeNode, path: string, newParent: string | null) => {
    const found = byPath.get(path)
    let next: string
    if (found !== undefined) next = found
    else if (!n.kept && newParent !== null) next = `c:${newParent}/${n.label}`
    else return
    if (next !== n.key) moves[n.key] = next
    for (const c of n.children) walk(c, `${path}\u0000${c.label}`, next)
  }
  walk(before, '', null)
  return moves
}
