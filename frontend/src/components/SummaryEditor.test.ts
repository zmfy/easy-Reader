// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount, config } from '@vue/test-utils'
import { nextTick } from 'vue'
import { ElDropdown } from 'element-plus'
import { CellSelection } from '@tiptap/pm/tables'
import SummaryEditor from './SummaryEditor.vue'
import type { DocNode } from '../types/study'

// BubbleMenu 依赖 tippy.js，在 vitest 的 Node 解析下无法加载（浏览器中由 Vite 预构建）；浮动工具栏在浏览器实测
config.global.stubs = { ...config.global.stubs, BubbleMenu: true }

const mk = (text: string, ref = 'n:1'): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }, { type: 'noteRef', attrs: { ref } }] }],
})

describe('SummaryEditor', () => {
  it('emits ref-click, hides toolbar when readonly, and loads external content', async () => {
    const w = mount(SummaryEditor, { props: { modelValue: mk('a'), readonly: false }, attachTo: document.body })
    await nextTick()
    expect(w.findAll('.se-btn')).toHaveLength(12)
    await w.find('span.note-ref').trigger('click')
    expect(w.emitted('ref-click')![0][0]).toBe('n:1')
    await w.setProps({ modelValue: mk('b', 'n:2') })
    expect(w.find('.ProseMirror').text()).toContain('b')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    await w.setProps({ readonly: true })
    expect(w.find('.se-toolbar').exists()).toBe(false)
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('false')
    w.unmount()
  })

  it('clears undo history on external load but keeps later edits undoable', async () => {
    const w = mount(SummaryEditor, { props: { modelValue: mk('a'), readonly: false }, attachTo: document.body })
    await nextTick()
    const editor = (w.vm as any).editor
    editor.commands.insertContentAt(1, 'x')
    expect(editor.can().undo()).toBe(true)
    await w.setProps({ modelValue: mk('b', 'n:2') })
    expect(w.find('.ProseMirror').text()).toContain('b')
    expect(editor.can().undo()).toBe(false)
    expect(w.find('button[aria-label="撤销"]').attributes('disabled')).toBeDefined()
    expect(w.emitted('update:modelValue')).toHaveLength(1)
    editor.commands.insertContentAt(1, 'y')
    expect(editor.can().undo()).toBe(true)
    editor.commands.undo()
    expect(JSON.stringify(editor.getJSON())).toBe(JSON.stringify(mk('b', 'n:2')))
    w.unmount()
  })

  it('switches to readonly with a notice when content is invalid', async () => {
    const bad: DocNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] }
    const w = mount(SummaryEditor, { props: { modelValue: bad, readonly: false }, attachTo: document.body })
    await nextTick()
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('false')
    expect(w.find('.se-toolbar').exists()).toBe(false)
    expect(w.text()).toContain('内容格式异常，已切换为只读，请联系管理员或用接口修复')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    w.unmount()
  })

  it('goes readonly when externally loaded content is invalid', async () => {
    const w = mount(SummaryEditor, { props: { modelValue: mk('a'), readonly: false }, attachTo: document.body })
    await nextTick()
    // listItem 第一个子节点不是 paragraph：不符合 schema
    const bad: DocNode = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] }] }] }] }
    await w.setProps({ modelValue: bad })
    expect(w.find('.ProseMirror').attributes('contenteditable')).toBe('false')
    expect(w.text()).toContain('内容格式异常')
    expect(w.emitted('update:modelValue')).toBeUndefined()
    w.unmount()
  })
})

const A = { colspan: 1, rowspan: 1, colwidth: null }
const tp = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const tcell = (type: string, text: string): DocNode => ({ type, attrs: { ...A }, content: [tp(text)] })
const tableNode: DocNode = { type: 'table', content: [
  { type: 'tableRow', content: [tcell('tableHeader', '命令'), tcell('tableHeader', '作用')] },
  { type: 'tableRow', content: [tcell('tableCell', 'ls'), tcell('tableCell', '列目录')] },
] }
// Vue 版 Editor 的响应式 state 在两次 requestAnimationFrame 后才触发更新
const raf = () => new Promise(r => requestAnimationFrame(() => r(null)))
const frame = async () => { await raf(); await raf(); await nextTick() }
const docOf = (...content: DocNode[]): DocNode => ({ type: 'doc', content })

describe('SummaryEditor tables, AI marks and tidy', () => {
  const mountEd = async (modelValue: DocNode, extra: Record<string, unknown> = {}) => {
    const w = mount(SummaryEditor, { props: { modelValue, readonly: false, ...extra }, attachTo: document.body })
    await nextTick()
    return { w, editor: (w.vm as any).editor }
  }

  it('shows table buttons only when the cursor is inside a table', async () => {
    const { w, editor } = await mountEd(docOf(tp('前'), tableNode))
    editor.commands.setTextSelection(2)
    await frame()
    expect(w.find('.se-table-tools').exists()).toBe(false)
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 4)
    await frame()
    const labels = w.findAll('.se-table-tools button').map(b => b.attributes('aria-label'))
    expect(labels).toEqual(['上方加行', '下方加行', '删除行', '左侧加列', '右侧加列', '删除列', '删除表格'])
    await w.find('.se-table-tools button[aria-label="下方加行"]').trigger('click')
    expect(editor.getJSON().content[1].content).toHaveLength(3)
    w.unmount()
  })

  it('insert table creates a 3-column table with a header row', async () => {
    const { w, editor } = await mountEd(docOf(tp('前')))
    editor.commands.setTextSelection(3)
    await w.find('.se-btn[aria-label="插入表格"]').trigger('click')
    const table = editor.getJSON().content.find((n: DocNode) => n.type === 'table')
    expect(table.content).toHaveLength(2)
    expect(table.content[0].content.map((c: DocNode) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    expect(table.content[1].content.map((c: DocNode) => c.type)).toEqual(['tableCell', 'tableCell', 'tableCell'])
    w.unmount()
  })

  it('removes aiAdded mark at the cursor', async () => {
    const d = docOf({ type: 'paragraph', content: [{ type: 'text', text: '我的' }, { type: 'text', text: 'AI补的', marks: [{ type: 'aiAdded' }] }] })
    const { w, editor } = await mountEd(d)
    editor.commands.setTextSelection(2)
    await frame()
    expect(w.find('.se-btn[aria-label="去掉 AI 标记"]').attributes('disabled')).toBeDefined()
    editor.commands.setTextSelection(5)
    await frame()
    const btn = w.find('.se-btn[aria-label="去掉 AI 标记"]')
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(editor.getJSON().content[0].content).toEqual([{ type: 'text', text: '我的AI补的' }])
    w.unmount()
  })

  it('emits tidy with whole-block selection and blocks h2 selections', async () => {
    const d = docOf({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '主题' }] }, tp('一二三'), tp('四五'))
    const { w, editor } = await mountEd(d, { tidyEnabled: true })
    const h2Size = editor.state.doc.child(0).nodeSize
    editor.commands.setTextSelection({ from: h2Size + 2, to: h2Size + 3 })
    await frame()
    const dd = w.findComponent(ElDropdown)
    expect(dd.props('disabled')).toBe(false)
    dd.vm.$emit('command', 'table')
    const ev = w.emitted('tidy')![0] as any[]
    expect(ev[0]).toBe('table')
    expect(ev[1].nodes).toEqual([tp('一二三')])
    expect(ev[1].from).toBe(h2Size)
    // 收起选区，让浮动工具栏隐藏（否则会浮在整理弹框上方）
    expect(editor.state.selection.empty).toBe(true)
    expect(editor.state.selection.from).toBe(h2Size + 3)
    // 选区含二级标题：禁用并提示
    editor.commands.setTextSelection({ from: 2, to: h2Size + 3 })
    await frame()
    expect(w.findComponent(ElDropdown).props('disabled')).toBe(true)
    expect(w.find('.se-tidy').attributes('title')).toBe('请在一个主题内选择')
    // 父组件不允许（如未配置 AI）时同样禁用，并用父组件的提示
    editor.commands.setTextSelection({ from: h2Size + 2, to: h2Size + 3 })
    await frame()
    await w.setProps({ tidyEnabled: false, tidyDisabledHint: '请先在 AI 插件设置中配置' })
    expect(w.findComponent(ElDropdown).props('disabled')).toBe(true)
    expect(w.find('.se-tidy').attributes('title')).toBe('请先在 AI 插件设置中配置')
    w.unmount()
  })

  it('after tidying from a cell selection the cursor lands in a text position', async () => {
    const { w, editor } = await mountEd(docOf(tp('前'), tableNode), { tidyEnabled: true })
    const tStart = editor.state.doc.child(0).nodeSize
    const a = tStart + 2
    const b = a + editor.state.doc.resolve(a).nodeAfter.nodeSize
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, a, b)))
    await frame()
    w.findComponent(ElDropdown).vm.$emit('command', 'table')
    expect(w.emitted('tidy')![0][1]).toMatchObject({ from: tStart })
    const sel = editor.state.selection
    expect(sel.empty).toBe(true)
    expect(sel.$from.parent.inlineContent).toBe(true)
    w.unmount()
  })

  it('replaceBlocks keeps aiAdded marks of the tidy result', async () => {
    const { w } = await mountEd(docOf(tp('甲')))
    const marked: DocNode = { type: 'paragraph', content: [{ type: 'text', text: '补', marks: [{ type: 'aiAdded' }] }] }
    const next = (w.vm as any).replaceBlocks(0, 3, [marked])
    expect(next.content[0]).toEqual(marked)
    w.unmount()
  })

  it('replaceBlocks replaces the range in one undoable step', async () => {
    const d = docOf(tp('甲'), tp('乙'), tp('丙'))
    const { w, editor } = await mountEd(d)
    const start = editor.state.doc.child(0).nodeSize
    const end = start + editor.state.doc.child(1).nodeSize
    const next = (w.vm as any).replaceBlocks(start, end, [tableNode])
    expect(next.content.map((n: DocNode) => n.type)).toEqual(['paragraph', 'table', 'paragraph'])
    expect(next.content[1]).toEqual(tableNode)
    expect(w.emitted('update:modelValue')!.at(-1)![0]).toEqual(next)
    editor.commands.undo()
    expect(editor.getJSON()).toEqual(d)
    w.unmount()
  })
})
