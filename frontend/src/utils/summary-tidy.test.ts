// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Editor } from '@tiptap/core'
import { CellSelection } from '@tiptap/pm/tables'
import { summaryExtensions } from './note-ref-extension'
import { selectionBlocks, tidyDisabledReason, TIDY_MAX_CHARS } from './summary-tidy'
import type { DocNode } from '../types/study'

const A = { colspan: 1, rowspan: 1, colwidth: null }
const t = (text: string): DocNode => ({ type: 'text', text })
const p = (text: string): DocNode => ({ type: 'paragraph', content: [t(text)] })
const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const cell = (text: string): DocNode => ({ type: 'tableCell', attrs: { ...A }, content: [p(text)] })
const table: DocNode = { type: 'table', content: [
  { type: 'tableRow', content: [cell('a'), cell('b')] },
  { type: 'tableRow', content: [cell('c'), cell('d')] },
] }

function editorWith(...content: DocNode[]) {
  return new Editor({ extensions: summaryExtensions(), content: { type: 'doc', content } })
}

// 第 n 个顶层块的起始位置
function blockStart(e: Editor, n: number): number {
  let pos = 0
  for (let i = 0; i < n; i++) pos += e.state.doc.child(i).nodeSize
  return pos
}

describe('selectionBlocks', () => {
  it('returns null for an empty selection', () => {
    const e = editorWith(p('一二三'))
    e.commands.setTextSelection(2)
    expect(selectionBlocks(e.state)).toBeNull()
    e.destroy()
  })

  it('selectionBlocks expands a partial paragraph selection to the whole paragraph', () => {
    const e = editorWith(p('前面'), p('一二三四'), p('后面'))
    const s = blockStart(e, 1)
    e.commands.setTextSelection({ from: s + 2, to: s + 3 })
    const sel = selectionBlocks(e.state)!
    expect(sel.from).toBe(s)
    expect(sel.to).toBe(s + e.state.doc.child(1).nodeSize)
    expect(sel.nodes).toEqual([p('一二三四')])
    expect(sel.hasTheme).toBe(false)
    expect(sel.textLength).toBe(4)
    e.destroy()
  })

  it('selectionBlocks expands a cell selection to the whole table', () => {
    const e = editorWith(p('x'), table, p('y'))
    const s = blockStart(e, 1)
    // 第一行第一格到第一格（CellSelection 锚点为格子位置）
    const firstCell = s + 2
    e.view.dispatch(e.state.tr.setSelection(CellSelection.create(e.state.doc, firstCell, firstCell + e.state.doc.resolve(firstCell).nodeAfter!.nodeSize)))
    let sel = selectionBlocks(e.state)!
    expect(sel.nodes).toEqual([table])
    expect(sel.from).toBe(s)
    // 格子里的文字选区同样整表
    e.commands.setTextSelection({ from: firstCell + 2, to: firstCell + 3 })
    sel = selectionBlocks(e.state)!
    expect(sel.nodes).toEqual([table])
    e.destroy()
  })

  it('selectionBlocks spans multiple blocks and flags h2', () => {
    const e = editorWith(h(2, '主题'), p('甲'), h(3, '小节'), p('乙'))
    e.commands.setTextSelection({ from: blockStart(e, 1) + 1, to: blockStart(e, 3) + 2 })
    let sel = selectionBlocks(e.state)!
    expect(sel.nodes.map(n => n.type)).toEqual(['paragraph', 'heading', 'paragraph'])
    expect(sel.hasTheme).toBe(false)
    e.commands.setTextSelection({ from: 2, to: blockStart(e, 1) + 2 })
    sel = selectionBlocks(e.state)!
    expect(sel.hasTheme).toBe(true)
    e.destroy()
  })
})

describe('tidyDisabledReason', () => {
  it('tidyDisabledReason returns the exact copy for each case', () => {
    const base = { from: 0, to: 1, nodes: [], hasTheme: false, textLength: 10 }
    expect(tidyDisabledReason(null)).toBe('请先选择要整理的内容')
    expect(tidyDisabledReason({ ...base, hasTheme: true })).toBe('请在一个主题内选择')
    expect(tidyDisabledReason({ ...base, textLength: TIDY_MAX_CHARS + 1 })).toBe('选中的内容太多，请分段整理')
    expect(tidyDisabledReason({ ...base, textLength: TIDY_MAX_CHARS })).toBeNull()
  })
})
