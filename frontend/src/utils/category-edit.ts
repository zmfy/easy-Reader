import type { CategoryNode } from '@/types'
import { CATEGORY_SEPARATOR } from './category'

/** 设置页分类树编辑：节点记住加载时的名字，保存时据此算出要同步到书的改名操作 */
export interface EditNode {
  id: number
  name: string
  /** 加载时的名字；新增的节点没有 */
  origName?: string
  children: EditNode[]
}

export const CATEGORY_MAX_DEPTH = 3

let seq = 0
export function newEditNode(name: string): EditNode {
  return { id: ++seq, name, children: [] }
}

export function fromTree(tree: CategoryNode[]): EditNode[] {
  return tree.map(n => ({ id: ++seq, name: n.name, origName: n.name, children: fromTree(n.children ?? []) }))
}

export function toTree(nodes: EditNode[]): CategoryNode[] {
  return nodes.map(n => (n.children.length ? { name: n.name, children: toTree(n.children) } : { name: n.name }))
}

const join = (parent: string, name: string) => (parent ? `${parent}${CATEGORY_SEPARATOR}${name}` : name)

/**
 * 改名操作（先序）：上级先改名，书的分类已变成「新上级/旧名」，所以下级的 from 用新的上级路径。
 * 删除的节点不产生操作（书保留原分类，会出现在「待整理」里）。
 */
export function computeRenames(nodes: EditNode[], parent = ''): Array<{ from: string; to: string }> {
  return nodes.flatMap((n) => {
    const own = n.origName && n.origName !== n.name ? [{ from: join(parent, n.origName), to: join(parent, n.name) }] : []
    return [...own, ...computeRenames(n.children, join(parent, n.name))]
  })
}

/** 新名字的问题（空、含 / 或逗号、过长、同级重名）；没问题返回 null */
export function nameError(name: string, siblings: EditNode[], self?: EditNode): string | null {
  const v = name.trim()
  if (!v) return '名称不能为空'
  if (/[/,，]/.test(v)) return '名称不能包含「/」或逗号'
  if (v.length > 20) return '名称不能超过 20 个字'
  if (siblings.some(s => s !== self && s.name === v)) return '同一级下已有这个分类'
  return null
}
