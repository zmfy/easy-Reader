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
})
