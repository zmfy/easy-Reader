import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment, Slice, type Node as PmNode } from '@tiptap/pm/model'

// 与后端 summary-doc 一致：每表最多 8 列、200 行，不支持合并单元格与列宽
export const TABLE_MAX_COLS = 8
export const TABLE_MAX_ROWS = 200

export function tableDims(doc: PmNode): { rows: number; cols: number } {
  let rows = 0
  let cols = 0
  doc.forEach(n => {
    if (n.type.name !== 'table') return
    rows = Math.max(rows, n.childCount)
    n.forEach(r => { cols = Math.max(cols, r.childCount) })
  })
  return { rows, cols }
}

const isCell = (n: PmNode) => n.type.name === 'tableCell' || n.type.name === 'tableHeader'
const plainAttrs = (n: PmNode) => ({ ...n.attrs, colspan: 1, rowspan: 1, colwidth: null })

// 合并单元格拆成多个格子（内容留在第一个），去掉列宽，截到上限并补齐每行格子数
function fixTable(table: PmNode): PmNode {
  const rows: PmNode[][] = []
  table.forEach(row => {
    if (rows.length >= TABLE_MAX_ROWS) return
    const cells: PmNode[] = []
    row.forEach(cell => {
      const span = Math.max(1, Number(cell.attrs.colspan) || 1)
      cells.push(cell.type.create(plainAttrs(cell), cell.content))
      for (let i = 1; i < span; i++) cells.push(cell.type.createAndFill(plainAttrs(cell))!)
    })
    rows.push(cells.slice(0, TABLE_MAX_COLS))
  })
  const width = Math.max(1, ...rows.map(r => r.length))
  const rowType = table.child(0).type
  const cellType = table.type.schema.nodes.tableCell
  return table.copy(Fragment.from(rows.map(cells => {
    while (cells.length < width) cells.push(cellType.createAndFill()!)
    return rowType.create(null, cells)
  })))
}

function fixFragment(fragment: Fragment): Fragment {
  const out: PmNode[] = []
  fragment.forEach(node => {
    if (node.type.name === 'table' && node.childCount > 0) out.push(fixTable(node))
    else if (isCell(node)) out.push(node.type.create(plainAttrs(node), node.content))
    else out.push(node.isLeaf ? node : node.copy(fixFragment(node.content)))
  })
  return Fragment.fromArray(out)
}

export const TableLimits = Extension.create({
  name: 'tableLimits',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableLimits'),
        // 加行、加列、Tab 新增行等：只要会让表格超出上限就拒绝（已超出的旧内容不因此变得无法编辑）
        filterTransaction(tr, state) {
          if (!tr.docChanged) return true
          const before = tableDims(state.doc)
          const after = tableDims(tr.doc)
          if (after.rows > TABLE_MAX_ROWS && after.rows > before.rows) return false
          if (after.cols > TABLE_MAX_COLS && after.cols > before.cols) return false
          return true
        },
        props: {
          transformPasted: slice => new Slice(fixFragment(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ]
  },
})
