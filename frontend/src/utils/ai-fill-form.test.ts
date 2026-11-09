import { describe, it, expect } from 'vitest'
import { initialForm, buildApplyPayload } from './ai-fill-form'
import type { AiFillPreview } from '@/types'

function preview(o: Partial<AiFillPreview> = {}): AiFillPreview {
  return {
    current: {
      title: '三国演义', author: '罗贯中', summary: '旧简介', category: '历史', is_finished: false,
      cover_url: '/covers/b1.jpg', recommended_tags: ['旧标签'], similar_works: [{ title: '水浒传' }],
      adaptations: [{ type: '电影', title: '赤壁', source: 'douban', url: 'https://movie.douban.com/subject/2/' }],
    },
    suggested: {
      author: '罗贯中（明）', summary: 'AI 简介', category: '古典小说', is_finished: true,
      recommended_tags: ['历史', '权谋'], similar_works: [{ title: '东周列国志', author: '冯梦龙' }],
      adaptations: [{ type: '电视剧', title: '三国演义', year: '1994', source: 'douban', url: 'https://movie.douban.com/subject/1/' }],
    },
    lockedFields: [],
    coverTitle: '三国演义',
    coverCandidates: [
      { title: 'a', pic: 'https://img1.doubanio.com/a.jpg', subjectUrl: 'https://book.douban.com/subject/1/', thumbnail: 'data:a' },
      { title: 'b', pic: 'https://img1.doubanio.com/b.jpg', subjectUrl: 'https://book.douban.com/subject/2/', thumbnail: 'data:b' },
    ],
    ...o,
  }
}

describe('initialForm', () => {
  it('uses AI adaptations, falling back to the current ones when AI found none', () => {
    expect(initialForm(preview()).adaptations.map(a => a.title)).toEqual(['三国演义'])
    const p = preview()
    p.suggested.adaptations = []
    const f = initialForm(p)
    expect(f.adaptations.map(a => a.title)).toEqual(['赤壁'])
    expect(buildApplyPayload(f, p).adaptations).toEqual(p.current.adaptations)
  })

  it('does not prefill low-confidence suggestions', () => {
    const p = preview({ lockedFields: ['summary'] })
    p.current.author = ''
    p.current.summary = ''
    p.suggested.confidence = { author: 'low', summary: 'low', category: 'high' }
    const f = initialForm(p)
    expect(f.author).toBe('')
    expect(f.summary).toBe('')
    expect(f.useAi.summary).toBe(false)
    expect(f.category).toBe('古典小说')
  })

  it('uses AI suggestions for unlocked fields', () => {
    const f = initialForm(preview())
    expect(f).toMatchObject({ author: '罗贯中（明）', summary: 'AI 简介', category: '古典小说', is_finished: true })
    expect(f.tags).toEqual(['历史', '权谋'])
    expect(f.similar).toEqual([{ title: '东周列国志', author: '冯梦龙' }])
  })

  it('keeps current values when AI returned nothing for a field', () => {
    const p = preview()
    p.suggested = { recommended_tags: [], similar_works: [], adaptations: [] }
    const f = initialForm(p)
    expect(f).toMatchObject({ author: '罗贯中', summary: '旧简介', category: '历史', is_finished: false })
    expect(f.tags).toEqual(['旧标签'])
    expect(f.similar).toEqual([{ title: '水浒传' }])
  })

  it('keeps the current value of a locked, non-empty field', () => {
    const f = initialForm(preview({ lockedFields: ['author'] }))
    expect(f.author).toBe('罗贯中')
    expect(f.useAi.author).toBe(false)
  })

  it('uses the AI value for a locked field that is currently empty', () => {
    const p = preview({ lockedFields: ['summary'] })
    p.current.summary = ''
    const f = initialForm(p)
    expect(f.summary).toBe('AI 简介')
    expect(f.useAi.summary).toBe(true)
  })

  it('selects the current cover, else the first candidate, else the default cover', () => {
    expect(initialForm(preview()).cover).toBe('current')
    const noCover = preview()
    noCover.current.cover_url = null
    expect(initialForm(noCover).cover).toBe(0)
    expect(initialForm({ ...noCover, coverCandidates: [] }).cover).toBe('default')
  })

  it('copies the lists so editing the form does not mutate the preview', () => {
    const p = preview()
    const f = initialForm(p)
    f.tags.push('新')
    f.similar.pop()
    expect(p.suggested.recommended_tags).toEqual(['历史', '权谋'])
    expect(p.suggested.similar_works).toHaveLength(1)
  })
})

describe('buildApplyPayload', () => {
  it('takes the rating from a book cover when an adaptation poster is chosen', () => {
    const p = preview()
    p.coverCandidates.push({ title: '三国演义', pic: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg', kind: '电视剧', thumbnail: 'data:p' })
    const f = initialForm(p)
    f.cover = 2
    const body = buildApplyPayload(f, p)
    expect(body.cover).toEqual({ type: 'douban', pic: 'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p1.jpg' })
    expect(body.ratingSubjectUrl).toBe('https://book.douban.com/subject/1/')
  })

  it('maps a douban candidate to its pic and rating subject', () => {
    const p = preview()
    const f = initialForm(p)
    f.cover = 1
    const body = buildApplyPayload(f, p)
    expect(body.cover).toEqual({ type: 'douban', pic: 'https://img1.doubanio.com/b.jpg' })
    expect(body.ratingSubjectUrl).toBe('https://book.douban.com/subject/2/')
  })

  it('maps current / default covers and falls back to the first candidate for the rating', () => {
    const p = preview()
    const f = initialForm(p)
    expect(buildApplyPayload(f, p).cover).toEqual({ type: 'keep' })
    f.cover = 'default'
    const body = buildApplyPayload(f, p)
    expect(body.cover).toEqual({ type: 'default' })
    expect(body.ratingSubjectUrl).toBe('https://book.douban.com/subject/1/')
  })

  it('echoes the AI suggestions and sends the edited values and lists', () => {
    const p = preview()
    const f = initialForm(p)
    f.summary = '我改过的'
    f.tags = []
    const body = buildApplyPayload(f, p)
    expect(body.suggested).toEqual({ author: '罗贯中（明）', summary: 'AI 简介', category: '古典小说' })
    expect(body).toMatchObject({ summary: '我改过的', author: '罗贯中（明）', recommended_tags: [], is_finished: true })
    expect(body.similar_works).toEqual([{ title: '东周列国志', author: '冯梦龙' }])
  })

  it('echoes the cover title used for the default cover', () => {
    const p = preview()
    expect(buildApplyPayload(initialForm(p), p).coverTitle).toBe('三国演义')
  })

  it('omits is_finished when unknown', () => {
    const p = preview()
    p.current.is_finished = null
    p.suggested.is_finished = undefined
    expect(buildApplyPayload(initialForm(p), p)).not.toHaveProperty('is_finished')
  })
})
