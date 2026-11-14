import { describe, it, expect } from 'vitest'
import { lookupStepText } from './lookup-step-text'

describe('lookupStepText', () => {
  it('describes searches with result counts', () => {
    expect(lookupStepText({ kind: 'search_book', query: '三体', count: 3 })).toBe('搜豆瓣书「三体」→ 3 条')
    expect(lookupStepText({ kind: 'search_movie', query: '三体', count: 0 })).toBe('搜豆瓣影视「三体」→ 0 条')
    expect(lookupStepText({ kind: 'search_drama', query: '三体', count: 2 })).toBe('搜猫耳「三体」→ 2 条')
  })

  it('shows an error instead of the count when the search failed', () => {
    expect(lookupStepText({ kind: 'search_book', query: '三体', count: 0, error: true })).toBe('搜豆瓣书「三体」→ 出错')
  })

  it('describes opening and confirming a book', () => {
    expect(lookupStepText({ kind: 'open_book', id: 'B1', label: '《三体》刘慈欣' })).toBe('打开 《三体》刘慈欣')
    expect(lookupStepText({ kind: 'confirm_book', id: 'B1', label: '《三体》刘慈欣' })).toBe('确认：《三体》刘慈欣')
    expect(lookupStepText({ kind: 'confirm_book', id: 'B1', label: '《三体》', why: '作者一致' })).toBe('确认：《三体》（作者一致）')
  })

  it('describes the remaining steps', () => {
    expect(lookupStepText({ kind: 'no_book' })).toBe('豆瓣没有这本书')
    expect(lookupStepText({ kind: 'no_book', why: '只有同名电影' })).toBe('豆瓣没有这本书（只有同名电影）')
    expect(lookupStepText({ kind: 'pick_adaptations', count: 2 })).toBe('选出 2 个改编')
    expect(lookupStepText({ kind: 'invalid' })).toBe('AI 回答无法识别')
  })
})
