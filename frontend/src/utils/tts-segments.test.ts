import { describe, it, expect } from 'vitest'
import { buildTtsSegments } from './tts-segments'

describe('buildTtsSegments', () => {
  it('merges short consecutive paragraphs up to the limit and records the paragraph range', () => {
    expect(buildTtsSegments(['甲甲', '乙乙', '丙丙丙丙丙丙'], { max: 6 })).toEqual([
      { text: '甲甲\n乙乙', b0: 0, b1: 1 },
      { text: '丙丙丙丙丙丙', b0: 2, b1: 2 },
    ])
  })

  it('splits a long paragraph at sentence ends, keeping each piece on the same paragraph', () => {
    const segs = buildTtsSegments(['第一句话。第二句话！第三句话？'], { max: 6 })
    expect(segs.map(s => s.text)).toEqual(['第一句话。', '第二句话！', '第三句话？'])
    expect(segs.every(s => s.b0 === 0 && s.b1 === 0)).toBe(true)
  })

  it('keeps closing quotes with their sentence and hard-cuts sentences longer than the limit', () => {
    expect(buildTtsSegments(['“走吧。”他说。'], { max: 5 }).map(s => s.text)).toEqual(['“走吧。”', '他说。'])
    expect(buildTtsSegments(['一二三四五六七八'], { max: 3 }).map(s => s.text)).toEqual(['一二三', '四五六', '七八'])
  })

  it('starts from the given paragraph and skips empty (hidden) ones', () => {
    expect(buildTtsSegments(['旧', '', '新段落'], { start: 1, max: 10 })).toEqual([{ text: '新段落', b0: 2, b1: 2 }])
  })

  it('prepends the chapter title as its own segment', () => {
    expect(buildTtsSegments(['正文'], { title: '第一章 绯红' })[0]).toEqual({ text: '第一章 绯红', b0: -1, b1: -1 })
  })
})
