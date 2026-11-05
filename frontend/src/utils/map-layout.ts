/**
 * 总导图布局（纯函数，不依赖 DOM）：水平树，根在左。
 * 纵向由 d3-hierarchy tree() 按固定行高排布；横向按每层最大节点宽度累加，同层左缘对齐。
 * 坐标约定：x = 节点左缘，y = 节点竖直中心；内容框左上角为 (0, 0)。
 */
import { hierarchy, tree } from 'd3-hierarchy'
import type { MapNode, MapNodeType } from './book-map'

export interface LaidOutNode { id: string; x: number; y: number; width: number; depth: number; data: MapNode; collapsed: boolean; hasChildren: boolean }
export interface LaidOutLink { from: string; to: string; path: string }   // SVG path d，水平三次贝塞尔

export const ROW_HEIGHT = 36
export const NODE_HEIGHT = 26
export const NODE_PAD_X = 12
/** 相邻两层之间的水平间距（含节点右侧折叠按钮的位置） */
export const COLUMN_GAP = 56
export const CONTENT_PAD = 24
/** 画布上节点文字最多显示的字数，超出截断加 …（完整文字见悬停提示/详情） */
export const LABEL_MAX = 24

export function displayLabel(label: string): string {
  const chars = Array.from(label.replace(/\s+/g, ' ').trim())
  return chars.length > LABEL_MAX ? chars.slice(0, LABEL_MAX).join('') + '…' : chars.join('')
}

/** 水平树（根在左）：d3-hierarchy tree().nodeSize([rowHeight, 0])，横向位置按各层最大文字宽度累加；collapsed 集合中的节点不展开子节点 */
export function layoutMap(
  root: MapNode,
  collapsed: Set<string>,
  measure: (label: string, type: MapNodeType) => number,
): { nodes: LaidOutNode[]; links: LaidOutLink[]; width: number; height: number } {
  const h = hierarchy(root, d => (collapsed.has(d.id) ? null : d.children))
  tree<MapNode>()
    .nodeSize([ROW_HEIGHT, 0])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.25))(h)

  const all = h.descendants()
  const widthOf = new Map<MapNode, number>()
  const colWidth: number[] = []
  let minBreadth = Infinity, maxBreadth = -Infinity
  for (const n of all) {
    const w = Math.ceil(measure(displayLabel(n.data.label), n.data.type)) + NODE_PAD_X * 2
    widthOf.set(n.data, w)
    colWidth[n.depth] = Math.max(colWidth[n.depth] ?? 0, w)
    minBreadth = Math.min(minBreadth, n.x!)
    maxBreadth = Math.max(maxBreadth, n.x!)
  }
  const colX: number[] = [CONTENT_PAD]
  for (let d = 1; d < colWidth.length; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + COLUMN_GAP

  const offsetY = CONTENT_PAD + ROW_HEIGHT / 2 - minBreadth
  const byData = new Map<MapNode, LaidOutNode>()
  const nodes: LaidOutNode[] = all.map(n => {
    const hasChildren = n.data.children.length > 0
    const laid: LaidOutNode = {
      id: n.data.id,
      x: colX[n.depth],
      y: n.x! + offsetY,
      width: widthOf.get(n.data)!,
      depth: n.depth,
      data: n.data,
      collapsed: hasChildren && collapsed.has(n.data.id),
      hasChildren,
    }
    byData.set(n.data, laid)
    return laid
  })

  const links: LaidOutLink[] = all.slice(1).map(n => {
    const p = byData.get(n.parent!.data)!, c = byData.get(n.data)!
    const x1 = p.x + p.width, y1 = p.y, x2 = c.x, y2 = c.y
    const mx = (x1 + x2) / 2
    return { from: p.id, to: c.id, path: `M${x1},${y1}C${mx},${y1} ${mx},${y2} ${x2},${y2}` }
  })

  const lastCol = colWidth.length - 1
  return {
    nodes,
    links,
    width: colX[lastCol] + colWidth[lastCol] + COLUMN_GAP / 2 + CONTENT_PAD,
    height: maxBreadth - minBreadth + ROW_HEIGHT + CONTENT_PAD * 2,
  }
}

/** 初始折叠：深度 ≥ maxDepth 的有子节点的节点 */
export function initialCollapsed(root: MapNode, maxDepth: number): Set<string> {
  const out = new Set<string>()
  const walk = (n: MapNode, depth: number) => {
    if (n.children.length === 0) return
    if (depth >= maxDepth) out.add(n.id)
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  return out
}
