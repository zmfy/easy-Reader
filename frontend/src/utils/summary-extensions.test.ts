// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'
import { summaryExtensions } from './note-ref-extension'
import type { DocNode } from '../types/study'

// happy-dom 缺少 ProseMirror 粘贴所需的 Range 几何方法：仅在本测试内补桩
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
  const proto = (document.createRange().constructor as any).prototype
  if (!proto.getClientRects) proto.getClientRects = () => []
  if (!proto.getBoundingClientRect) proto.getBoundingClientRect = () => rect
})

const A = { colspan: 1, rowspan: 1, colwidth: null }
const para = (...content: DocNode[]): DocNode => ({ type: 'paragraph', content })
const cell = (type: string, ...content: DocNode[]): DocNode => ({ type, attrs: { ...A }, content: [para(...content)] })

const tableDoc: DocNode = {
  type: 'doc',
  content: [{
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', { type: 'text', text: '命令' }), cell('tableHeader', { type: 'text', text: '作用' })] },
      { type: 'tableRow', content: [
        cell('tableCell', { type: 'text', text: 'ls', marks: [{ type: 'code' }] }),
        cell('tableCell', { type: 'text', text: '列目录' }, { type: 'text', text: '，-a 显示隐藏', marks: [{ type: 'aiAdded' }] }, { type: 'noteRef', attrs: { ref: 'h:1' } }),
      ] },
    ],
  }],
}

describe('summaryExtensions tables and aiAdded', () => {
  it('round-trips a table with header row and aiAdded marks unchanged', () => {
    const editor = new Editor({ extensions: summaryExtensions(), content: tableDoc })
    expect(editor.getJSON()).toEqual(tableDoc)
    expect(editor.getHTML()).toContain('<span class="ai-added" title="AI 补充，未出自你的笔记">')
    editor.destroy()
  })

  it('rejects block content other than paragraphs inside cells', () => {
    const editor = new Editor({ extensions: summaryExtensions() })
    const bad: DocNode = {
      type: 'doc',
      content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { ...A }, content: [
        { type: 'bulletList', content: [{ type: 'listItem', content: [para({ type: 'text', text: 'x' })] }] },
      ] }] }] }],
    }
    expect(() => createDocument(bad as any, editor.schema, {}, { errorOnInvalidContent: true })).toThrow()
    editor.destroy()
  })

  it('typing at the end of aiAdded text does not extend the mark', () => {
    const d: DocNode = { type: 'doc', content: [para({ type: 'text', text: '补充', marks: [{ type: 'aiAdded' }] })] }
    const editor = new Editor({ extensions: summaryExtensions(), content: d })
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('我')
    expect(editor.getJSON().content![0].content).toEqual([
      { type: 'text', text: '补充', marks: [{ type: 'aiAdded' }] },
      { type: 'text', text: '我' },
    ])
    editor.destroy()
  })

  it('parses ai-added spans from HTML', () => {
    const editor = new Editor({ extensions: summaryExtensions(), content: '<p>a<span class="ai-added">b</span></p>' })
    expect(editor.getJSON().content![0].content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b', marks: [{ type: 'aiAdded' }] },
    ])
    editor.destroy()
  })
})

const gridDoc = (cols: number, rows: number): DocNode => ({
  type: 'doc',
  content: [{ type: 'table', content: Array.from({ length: rows }, (_, r) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, (_, c) => cell(r === 0 ? 'tableHeader' : 'tableCell', { type: 'text', text: `${r}-${c}` })),
  })) }],
})
const dims = (e: Editor) => {
  const t = e.getJSON().content!.find(n => n.type === 'table')!
  return { rows: t.content!.length, cols: Math.max(...t.content!.map(r => r.content!.length)) }
}

describe('table limits match the backend (8 columns, 200 rows, no merged cells)', () => {
  it('cannot add a 9th column or a 201st row', () => {
    const e = new Editor({ extensions: summaryExtensions(), content: gridDoc(8, 200) })
    e.commands.setTextSelection(4)
    e.commands.addColumnAfter()
    e.commands.addRowAfter()
    expect(dims(e)).toEqual({ rows: 200, cols: 8 })
    e.destroy()
  })

  it('still adds rows and columns below the limits', () => {
    const e = new Editor({ extensions: summaryExtensions(), content: gridDoc(2, 2) })
    e.commands.setTextSelection(4)
    e.commands.addColumnAfter()
    e.commands.addRowAfter()
    expect(dims(e)).toEqual({ rows: 3, cols: 3 })
    e.destroy()
  })

  it('pasted tables lose merged cells and widths and are cut to the limits', () => {
    const e = new Editor({ extensions: summaryExtensions(), content: { type: 'doc', content: [para({ type: 'text', text: 'x' })] } })
    e.commands.setTextSelection(2)
    const wide = '<tr>' + Array.from({ length: 10 }, (_, i) => `<td>c${i}</td>`).join('') + '</tr>'
    e.view.pasteHTML(`<table><tr><td colspan="2" data-colwidth="100,50">a</td><td rowspan="2">r</td></tr><tr><td>b</td><td>c</td></tr>${wide}</table>`)
    const t = e.getJSON().content!.find(n => n.type === 'table')!
    const cells = t.content!.flatMap(r => r.content!)
    expect(cells.every(c => c.attrs!.colspan === 1 && c.attrs!.rowspan === 1 && c.attrs!.colwidth === null)).toBe(true)
    const widths = t.content!.map(r => r.content!.length)
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBeLessThanOrEqual(8)
    e.destroy()
  })
})

describe('aiAdded is never extended by typing', () => {
  it('typing in the middle of aiAdded text does not carry the mark', () => {
    const d: DocNode = { type: 'doc', content: [para({ type: 'text', text: '补充内容', marks: [{ type: 'aiAdded' }] })] }
    const editor = new Editor({ extensions: summaryExtensions(), content: d })
    editor.commands.setTextSelection(3)
    editor.commands.insertContent('我')
    expect(editor.getJSON().content![0].content).toEqual([
      { type: 'text', text: '补充', marks: [{ type: 'aiAdded' }] },
      { type: 'text', text: '我' },
      { type: 'text', text: '内容', marks: [{ type: 'aiAdded' }] },
    ])
    editor.destroy()
  })

  it('undo and pasted / programmatically inserted marked content keep the mark', () => {
    const marked = { type: 'text', text: 'AI', marks: [{ type: 'aiAdded' }] }
    let editor = new Editor({ extensions: summaryExtensions(), content: { type: 'doc', content: [para({ type: 'text', text: 'ab' })] } })
    editor.chain().setMeta('keepAiAdded', true).insertContentAt(2, marked).run()
    expect(editor.getJSON().content![0].content![1]).toEqual(marked)
    // 撤销：从带标记的文档开始，删掉再撤销
    editor.destroy()
    const start: DocNode = { type: 'doc', content: [para({ type: 'text', text: 'a' }, marked as DocNode, { type: 'text', text: 'b' })] }
    editor = new Editor({ extensions: summaryExtensions(), content: start })
    editor.commands.setTextSelection({ from: 2, to: 4 })
    editor.commands.deleteSelection()
    editor.commands.undo()
    expect(editor.getJSON().content![0].content![1]).toEqual(marked)
    editor.commands.setTextSelection(1)
    editor.view.pasteHTML('<p><span class="ai-added">粘</span></p>')
    expect(editor.getJSON().content!.flatMap(p => p.content || [])).toContainEqual({ type: 'text', text: '粘', marks: [{ type: 'aiAdded' }] })
    editor.destroy()
  })
})
