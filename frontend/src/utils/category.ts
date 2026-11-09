import type { CategoryNode } from '@/types'

/** 多级分类：书的分类是路径「小说/网络小说/玄幻」（见 backend/src/utils/category-tree.ts） */
export const CATEGORY_SEPARATOR = '/'

export interface CategoryOption {
  [key: string]: unknown
  value: string
  label: string
  children?: CategoryOption[]
}

/** 分类树 → el-cascader 选项；value 为完整路径。传 counts 时标签后带书数 */
export function toCategoryOptions(tree: CategoryNode[], counts?: Record<string, number>, prefix = ''): CategoryOption[] {
  return tree.map((node) => {
    const value = prefix ? `${prefix}${CATEGORY_SEPARATOR}${node.name}` : node.name
    const n = counts?.[value]
    return {
      value,
      label: counts ? `${node.name}${n ? `（${n}）` : ''}` : node.name,
      ...(node.children?.length ? { children: toCategoryOptions(node.children, counts, value) } : {}),
    }
  })
}

/** 显示用：小说 › 网络小说 › 玄幻 */
export function categoryLabel(path: string | null | undefined): string {
  return (path || '').split(CATEGORY_SEPARATOR).filter(Boolean).join(' › ')
}

/** 末级名：卡片等空间小的地方用 */
export function categoryLeaf(path: string | null | undefined): string {
  return (path || '').split(CATEGORY_SEPARATOR).filter(Boolean).pop() || ''
}

export function categoryPaths(tree: CategoryNode[], prefix = ''): string[] {
  return tree.flatMap((node) => {
    const path = prefix ? `${prefix}${CATEGORY_SEPARATOR}${node.name}` : node.name
    return [path, ...categoryPaths(node.children ?? [], path)]
  })
}
