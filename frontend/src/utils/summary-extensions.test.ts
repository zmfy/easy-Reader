// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { Editor, createDocument } from '@tiptap/core'
import { summaryExtensions } from './note-ref-extension'
import type { DocNode } from '../types/study'

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
