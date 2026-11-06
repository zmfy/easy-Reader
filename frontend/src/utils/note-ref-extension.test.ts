// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Slice } from '@tiptap/pm/model'
import { NoteRef, summaryExtensions } from './note-ref-extension'
import type { DocNode } from '../types/study'

// happy-dom 缺少 ProseMirror 粘贴/选区所需的 Range 几何方法：仅在本测试内补桩
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
  const proto = (document.createRange().constructor as any).prototype
  if (!proto.getClientRects) proto.getClientRects = () => []
  if (!proto.getBoundingClientRect) proto.getBoundingClientRect = () => rect
})

const doc: DocNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '主题' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '见' }, { type: 'noteRef', attrs: { ref: 'h:abc-1' } }] },
  ],
}

describe('noteRef', () => {
  it('noteRef round-trips JSON', () => {
    const editor = new Editor({ extensions: [StarterKit, NoteRef], content: doc })
    expect(editor.getJSON()).toEqual(doc)
    editor.destroy()
  })

  it('renders as span.note-ref with data-ref', () => {
    const editor = new Editor({ extensions: [StarterKit, NoteRef], content: doc })
    const el = editor.view.dom.querySelector('span.note-ref')
    expect(el?.getAttribute('data-ref')).toBe('h:abc-1')
    expect(el?.textContent).toBe('📖')
    editor.destroy()
  })

  it('pasted html cannot create noteRef', () => {
    const editor = new Editor({ extensions: [StarterKit, NoteRef], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    editor.view.pasteHTML('<p>x<span class="note-ref" data-ref="h:forged">📖</span>y</p>')
    expect(JSON.stringify(editor.getJSON())).not.toContain('noteRef')
    editor.destroy()
  })

  it.each([
    ['slash separator', '<p>x<span class="note-ref"/data-ref="h:forged">📖</span>y</p>'],
    ['newline separator', '<p>x<span class="note-ref"\ndata-ref="h:forged">📖</span>y</p>'],
    ['attribute order reversed', '<p>x<span data-ref="h:forged" class="note-ref">📖</span>y</p>'],
  ])('pasted html cannot create noteRef (%s)', (_n, html) => {
    const editor = new Editor({ extensions: [StarterKit, NoteRef], content: { type: 'doc', content: [{ type: 'paragraph' }] } })
    editor.view.pasteHTML(html)
    expect(JSON.stringify(editor.getJSON())).not.toContain('noteRef')
    expect(JSON.stringify(editor.getJSON())).toContain('x')
    editor.destroy()
  })
})

describe('noteRef allowed set', () => {
  const two: DocNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '甲' }, { type: 'noteRef', attrs: { ref: 'h:abc-1' } }] },
      { type: 'paragraph', content: [{ type: 'text', text: '乙' }] },
    ],
  }
  const refsOf = (e: Editor) => (JSON.stringify(e.getJSON()).match(/"ref":"[^"]+"/g) || [])
  // 与 prosemirror-view handleDrop / 粘贴一致：经 transformPasted 处理后插入
  const transform = (e: Editor, slice: Slice) => e.view.someProp('transformPasted', f => f(slice, e.view, false)) || slice

  it('dragging a paragraph inside the editor keeps its refs', () => {
    const editor = new Editor({ extensions: summaryExtensions(), content: two })
    const first = editor.state.doc.child(0)
    const slice = editor.state.doc.slice(0, first.nodeSize)
    const out = transform(editor, slice)
    expect(JSON.stringify(out.content.toJSON())).toContain('h:abc-1')
    // 拖到第二段之后（move）
    const end = editor.state.doc.content.size
    editor.chain().insertContentAt(end, out.content.toJSON()).deleteRange({ from: 0, to: first.nodeSize }).run()
    expect(refsOf(editor)).toEqual(['"ref":"h:abc-1"'])
    expect(editor.state.doc.child(0).textContent).toBe('乙')
    editor.destroy()
  })

  it('copy-paste of an existing ref keeps it', () => {
    const editor = new Editor({ extensions: summaryExtensions(), content: two })
    editor.commands.setTextSelection(editor.state.doc.content.size - 1)
    editor.view.pasteHTML('<p>x<span class="note-ref" data-ref="h:abc-1">📖</span>y</p>')
    expect(refsOf(editor)).toHaveLength(2)
    editor.destroy()
  })

  it('cut then paste keeps refs listed in allowedRefs', () => {
    const editor = new Editor({ extensions: summaryExtensions({ allowedRefs: () => ['h:abc-1'] }), content: two })
    const first = editor.state.doc.child(0)
    editor.commands.deleteRange({ from: 0, to: first.nodeSize })
    expect(refsOf(editor)).toEqual([])
    editor.view.pasteHTML('<p>x<span class="note-ref" data-ref="h:abc-1">📖</span>y</p>')
    expect(refsOf(editor)).toEqual(['"ref":"h:abc-1"'])
    editor.destroy()
  })

  it('forged refs outside the allowed set are still dropped', () => {
    const editor = new Editor({ extensions: summaryExtensions({ allowedRefs: () => ['h:abc-1'] }), content: two })
    editor.view.pasteHTML('<p>x<span class="note-ref" data-ref="h:forged">📖</span>y</p>')
    expect(JSON.stringify(editor.getJSON())).not.toContain('h:forged')
    expect(JSON.stringify(editor.getJSON())).toContain('x')
    const forged = Slice.fromJSON(editor.schema, { content: [{ type: 'paragraph', content: [{ type: 'noteRef', attrs: { ref: 'n:zzz' } }] }] })
    expect(JSON.stringify(transform(editor, forged).content.toJSON())).not.toContain('n:zzz')
    editor.destroy()
  })
})

// 与后端 isValidDoc 同口径的白名单（前端自备，不从后端 import）
const NODES = new Set(['doc', 'heading', 'paragraph', 'bulletList', 'orderedList', 'listItem', 'codeBlock', 'hardBreak', 'text', 'noteRef'])
const MARKS = new Set(['bold', 'italic', 'code'])
const ATTRS: Record<string, string[]> = { heading: ['level'], orderedList: ['start', 'type'], codeBlock: ['language'], noteRef: ['ref'] }
function violations(n: DocNode, out: string[] = []): string[] {
  if (!NODES.has(n.type)) out.push(`node:${n.type}`)
  for (const k of Object.keys(n.attrs || {})) if (!(ATTRS[n.type] || []).includes(k)) out.push(`attr:${n.type}.${k}`)
  if (n.type === 'heading' && ![2, 3].includes(n.attrs?.level as number)) out.push('heading.level')
  for (const m of n.marks || []) if (!MARKS.has(m.type)) out.push(`mark:${m.type}`)
  ;(n.content || []).forEach(c => violations(c, out))
  return out
}

describe('summaryExtensions', () => {
  it('editor output stays within the backend whitelist', () => {
    const editor = new Editor({ extensions: summaryExtensions(), content: '<p>abc def ghi</p><p>title</p>' })
    editor.chain().setTextSelection({ from: 1, to: 4 }).toggleBold().run()
    editor.chain().setTextSelection({ from: 5, to: 8 }).toggleItalic().run()
    editor.chain().setTextSelection({ from: 9, to: 12 }).toggleCode().run()
    editor.chain().setTextSelection(16).toggleHeading({ level: 2 }).run()
    // 在末尾追加：H3、两种列表、代码块、换行，以及不在白名单内的输入（应被降级而非保留）
    const end = editor.state.doc.content.size
    editor.chain().insertContentAt(end, '<h3>h3</h3><ul><li>a</li></ul><ol><li>b</li></ol><pre><code>x</code></pre><p>q<br>r</p>').run()
    editor.chain().insertContentAt(editor.state.doc.content.size, '<blockquote><p>q</p></blockquote><hr><p><s>st</s></p><h1>one</h1><h4>four</h4>').run()
    const json = editor.getJSON() as DocNode
    const text = JSON.stringify(json)
    for (const t of ['heading', 'bulletList', 'orderedList', 'codeBlock', 'hardBreak', 'bold', 'italic', 'code']) expect(text).toContain(`"${t}"`)
    expect(violations(json)).toEqual([])
    editor.destroy()
  })
})
