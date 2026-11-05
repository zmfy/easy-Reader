/**
 * 多层目录（EPUB 原书目录层级、TXT 分卷）整理成树，供目录抽屉折叠显示。
 * 章节仍是一个按阅读顺序的平铺列表，这里只算出每章的深度、上级与下级。
 */
export interface TocNode {
  /** 章节序号；不是章节的分组行（TXT「第一部 小丑」）为负数 */
  index: number
  /** 仅分组行有：显示的标题 */
  title?: string
  depth: number
  parent: number | null
  children: number[]
}

export interface TocTree extends Array<TocNode> {
  /** 是否存在下级（没有时目录按原来的平铺列表显示） */
  hasNesting: boolean
  /** index → 数组位置 */
  pos: Map<number, number>
}

export interface TocRow {
  index: number
  title?: string
  depth: number
  hasChildren: boolean
  expanded: boolean
}

export function buildTocTree(chapters: Array<{ index: number; level?: number; groupTitle?: string }>): TocTree {
  const nodes = [] as unknown as TocTree
  nodes.pos = new Map()
  // 栈里是当前路径上的祖先；层级跳跃（1 → 3）时子项挂到最近的上层，深度按栈计算
  const stack: Array<{ index: number; level: number }> = []
  let groupKey = 0
  const add = (index: number, level: number, title?: string) => {
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
    const parent = stack.length ? stack[stack.length - 1].index : null
    nodes.pos.set(index, nodes.length)
    nodes.push({ index, depth: stack.length, parent, children: [], ...(title !== undefined ? { title } : {}) })
    if (parent !== null) nodes[nodes.pos.get(parent)!].children.push(index)
    stack.push({ index, level })
  }
  for (const ch of chapters) {
    const level = ch.level ?? 0
    // 分组行放在开始它的那一章之前，比该章高一层
    if (ch.groupTitle) add(-(++groupKey), level - 1, ch.groupTitle)
    add(ch.index, level)
  }
  nodes.hasNesting = nodes.some(n => n.depth > 0)
  return nodes
}

/** 某章的全部上级（由近到远） */
export function tocAncestors(tree: TocTree, index: number): number[] {
  const result: number[] = []
  let node = tree[tree.pos.get(index) ?? -1]
  while (node && node.parent !== null) {
    result.push(node.parent)
    node = tree[tree.pos.get(node.parent) ?? -1]
  }
  return result
}

/** 按展开状态生成可见行；倒序时每一层内倒序，上级始终在下级之前 */
export function visibleTocRows(tree: TocTree, expanded: Set<number>, reversed: boolean): TocRow[] {
  const rows: TocRow[] = []
  const order = (list: number[]) => (reversed ? [...list].reverse() : list)
  const walk = (indices: number[]) => {
    for (const index of order(indices)) {
      const node = tree[tree.pos.get(index)!]
      const hasChildren = node.children.length > 0
      const isOpen = hasChildren && expanded.has(index)
      rows.push({ index, title: node.title, depth: node.depth, hasChildren, expanded: isOpen })
      if (isOpen) walk(node.children)
    }
  }
  walk(tree.filter(n => n.parent === null).map(n => n.index))
  return rows
}
