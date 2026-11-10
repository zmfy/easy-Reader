import { describe, it, expect } from 'vitest'
import { defaultChoice, toSelection, hasSelection, parseContentMismatch } from './ai-suggestions'
import type { AiSuggestion } from '@/types'

const s: AiSuggestion = {
  book_id: 'b1', title: '西游记', author: '佚名', cover_url: null, created_at: '', batch_no: 1, content_mismatch: null,
  current: { recommended_tags: [], similar_works: [], adaptations: [] },
  data: {
    fields: {
      author: { value: '吴承恩', current: '佚名', confidence: 'high', locked: true },
      summary: { value: '取经', current: null, confidence: 'medium' },
      category: { value: '小说/中国古典小说', current: '玄幻', confidence: 'low' },
    },
    recommended_tags: ['神魔'],
  },
}

describe('ai suggestion helpers', () => {
  it('pre-selects confident, unlocked fields and present lists', () => {
    expect(defaultChoice(s)).toEqual({
      fields: { title: false, author: false, summary: true, category: false }, tags: true, similar: false, adaptations: false,
    })
  })

  it('selects nothing by default for a mismatched file', () => {
    expect(defaultChoice({ ...s, content_mismatch: { title: '诡秘之主' } })).toEqual({
      fields: { title: false, author: false, summary: false, category: false }, tags: false, similar: false, adaptations: false,
    })
  })

  it('builds the apply payload only from parts that exist', () => {
    const c = defaultChoice(s)
    c.fields.author = true
    c.similar = true  // 没有类似作品建议：不提交
    expect(toSelection(s, c)).toEqual({ book_id: 'b1', fields: ['author', 'summary'], tags: true, similar: false, adaptations: false })
    expect(hasSelection({ fields: { title: false, author: false, summary: false, category: false }, tags: false, similar: false, adaptations: false })).toBe(false)
  })

  it('错标的书勾上「书名」才提交书名，作为第一项', () => {
    const m: AiSuggestion = {
      ...s, content_mismatch: { title: '诡秘之主' },
      data: { fields: { title: { value: '诡秘之主', current: '西游记', confidence: 'medium' }, ...s.data.fields } },
    }
    const c = defaultChoice(m)
    expect(c.fields.title).toBe(false)
    c.fields.title = true
    c.fields.summary = true
    expect(toSelection(m, c).fields).toEqual(['title', 'summary'])
    expect(hasSelection(c)).toBe(true)
  })

  it('parses active content mismatch only', () => {
    expect(parseContentMismatch('{"title":"诡秘之主","author":"爱潜水的乌贼"}')).toEqual({ title: '诡秘之主', author: '爱潜水的乌贼' })
    expect(parseContentMismatch('{"title":"诡秘之主","dismissed":true}')).toBeNull()
    expect(parseContentMismatch('bad')).toBeNull()
    expect(parseContentMismatch(null)).toBeNull()
  })
})
