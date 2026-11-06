import { describe, it, expect } from 'vitest'
import { countThemes } from './summary-doc'
import type { DocNode } from '@/types/study'

const h = (level: number, text: string): DocNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })

describe('countThemes', () => {
  it('counts top-level h2', () => {
    const doc: DocNode = {
      type: 'doc',
      content: [
        h(2, '主题一'),
        { type: 'paragraph' },
        h(3, '小节'),
        h(2, '主题二'),
        { type: 'bulletList', content: [{ type: 'listItem', content: [h(2, '嵌套不算')] }] },
      ],
    }
    expect(countThemes(doc)).toBe(2)
  })
})
