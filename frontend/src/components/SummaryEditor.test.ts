// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SummaryEditor from './SummaryEditor.vue'
import type { DocNode } from '../types/study'

const mk = (text: string, ref = 'n:1'): DocNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }, { type: 'noteRef', attrs: { ref } }] }],
})

describe('SummaryEditor', () => {
  it('emits ref-click, hides toolbar when readonly, and loads external content', async () => {
    const w = mount(SummaryEditor, { props: { modelValue: mk('a'), readonly: false }, attachTo: document.body })
    await nextTick()
    expect(w.findAll('.se-btn')).toHaveLength(10)
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
