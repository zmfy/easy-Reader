import type { EditorState } from '@tiptap/pm/state'
import type { DocNode } from '../types/study'

// AI 整理的选区：选区碰到的每个顶层块整块算入（表格内的格子选区 = 整张表）
export interface SelectionBlocks {
  /** 所涉顶层块在文档中的起止位置（块边界） */
  from: number
  to: number
  nodes: DocNode[]
  /** 含二级标题（主题名）：整理只能在一个主题内进行 */
  hasTheme: boolean
  textLength: number
}

export const TIDY_MAX_CHARS = 6000

export function selectionBlocks(state: EditorState): SelectionBlocks | null {
  const sel = state.selection
  if (sel.empty) return null
  let start = -1
  let end = -1
  const nodes: DocNode[] = []
  let hasTheme = false
  let textLength = 0
  state.doc.forEach((node, offset) => {
    const nodeEnd = offset + node.nodeSize
    // 只碰到块的边界（未选中其中任何内容）不算
    if (sel.to <= offset + 1 || sel.from >= nodeEnd - 1) return
    if (start < 0) start = offset
    end = nodeEnd
    nodes.push(node.toJSON() as DocNode)
    if (node.type.name === 'heading' && node.attrs.level === 2) hasTheme = true
    textLength += Array.from(node.textContent).length
  })
  if (!nodes.length) return null
  return { from: start, to: end, nodes, hasTheme, textLength }
}

export function tidyDisabledReason(sel: SelectionBlocks | null): string | null {
  if (!sel) return '请先选择要整理的内容'
  if (sel.hasTheme) return '请在一个主题内选择'
  if (sel.textLength > TIDY_MAX_CHARS) return '选中的内容太多，请分段整理'
  return null
}
