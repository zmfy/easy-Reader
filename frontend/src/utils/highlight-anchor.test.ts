// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { rangeToAnchor, locateHighlight, overlaps, applyHighlights, clearHighlights, pickChapterHighlights, chapterContentOf, checkNewHighlight } from './highlight-anchor'

const HTML = '<p>项羽者，下相人也。</p><p>字羽。初起时，年二十四。</p><p>其季父项梁。</p>'
let content: HTMLElement

function selectIn(node: Node, s: number, node2: Node, e: number): Range {
  const r = document.createRange()
  r.setStart(node, s)
  r.setEnd(node2, e)
  return r
}

beforeEach(() => {
  document.body.innerHTML = `<div id="c">${HTML}</div><span id="out">外部</span>`
  content = document.getElementById('c')!
})

describe('rangeToAnchor', () => {
  it('maps a selection inside one paragraph', () => {
    const t = content.firstElementChild!.firstChild!
    expect(rangeToAnchor(content, selectIn(t, 4, t, 7))).toEqual({ anchor: { start: 4, end: 7 }, text: '下相人' })
  })

  it('trims whitespace and rejects empty / outside ranges', () => {
    content.innerHTML = '<p>  ab  </p>'
    const t = content.firstElementChild!.firstChild!
    expect(rangeToAnchor(content, selectIn(t, 0, t, 6))).toEqual({ anchor: { start: 2, end: 4 }, text: 'ab' })
    expect(rangeToAnchor(content, selectIn(t, 0, t, 2))).toBeNull()
    const out = document.getElementById('out')!.firstChild!
    expect(rangeToAnchor(content, selectIn(out, 0, out, 2))).toBeNull()
    expect(rangeToAnchor(content, selectIn(t, 2, out, 1))).toBeNull()
  })
})

describe('locateHighlight', () => {
  const full = '项羽者，下相人也。字羽。'
  it('keeps a matching offset, relocates a shifted one, and gives up', () => {
    const stored = { start: 4, end: 7, text: '下相人' }
    expect(locateHighlight(full, stored)).toEqual({ start: 4, end: 7 })
    expect(locateHighlight('前言：' + full, stored)).toEqual({ start: 7, end: 10 })
    expect(locateHighlight('完全不同', stored)).toBeNull()
    expect(locateHighlight('甲乙xx甲乙xxxxxxxx甲乙', { start: 12, end: 14, text: '甲乙' })).toEqual({ start: 14, end: 16 })
    expect(locateHighlight('甲乙xx甲乙xxxxxxxx甲乙', { start: 3, end: 5, text: '甲乙' })).toEqual({ start: 4, end: 6 })
  })
})

describe('overlaps', () => {
  it('uses half-open intervals', () => {
    expect(overlaps({ start: 0, end: 5 }, { start: 5, end: 8 })).toBe(false)
    expect(overlaps({ start: 0, end: 5 }, { start: 4, end: 8 })).toBe(true)
    expect(overlaps({ start: 0, end: 9 }, { start: 2, end: 4 })).toBe(true)
  })
})

describe('applyHighlights 空白节点', () => {
  it('跨段落划线不给段落间换行或列表结构空白包 mark', () => {
    content.innerHTML = '<p>a</p>\n<p>b</p><ul>\n<li>c</li>\n</ul>'
    const before = content.textContent
    applyHighlights(content, [{ id: 'h1', anchor: { start: 0, end: before!.length }, hasNote: false }])
    expect(content.textContent).toBe(before)
    const marks = [...content.querySelectorAll('mark.hl')]
    expect(marks.length).toBe(3)
    expect(marks.some(m => m.parentElement === content || m.parentElement!.tagName === 'UL')).toBe(false)
    expect(marks.some(m => !m.textContent!.trim())).toBe(false)
  })
})

describe('applyHighlights', () => {
  const text = '项羽者，下相人也。字羽。初起时，年二十四。其季父项梁。'
  const span = { start: text.indexOf('下相人也。字羽'), end: text.indexOf('下相人也。字羽') + 7 }

  it('wraps a range spanning several paragraphs', () => {
    const before = content.textContent
    applyHighlights(content, [{ id: 'h1', anchor: span, hasNote: false }])
    const marks = content.querySelectorAll('mark.hl[data-hl-id="h1"]')
    expect(marks.length).toBe(2)
    const ps = content.querySelectorAll('p')
    expect(ps.length).toBe(3)
    expect(ps[0].contains(marks[0])).toBe(true)
    expect(ps[1].contains(marks[1])).toBe(true)
    expect(content.textContent).toBe(before)
  })

  it('is idempotent', () => {
    const before = content.textContent
    const items = [{ id: 'h1', anchor: span, hasNote: false }]
    applyHighlights(content, items)
    applyHighlights(content, items)
    expect(content.querySelectorAll('mark.hl').length).toBe(2)
    expect(content.querySelector('mark mark')).toBeNull()
    clearHighlights(content)
    expect(content.querySelector('mark')).toBeNull()
    expect(content.textContent).toBe(before)
    expect(content.querySelectorAll('p')[0].childNodes.length).toBe(1)
  })

  it('marks notes', () => {
    applyHighlights(content, [{ id: 'h1', anchor: span, hasNote: true }])
    expect(content.querySelector('mark.hl')!.classList.contains('has-note')).toBe(true)
  })
})

describe('pickChapterHighlights', () => {
  const full = '项羽者，下相人也。字羽。初起时，年二十四。'
  const h = (id: string, text: string, start: number, createdAt: string, note: string | null = null) =>
    ({ id, start_offset: start, end_offset: start + text.length, text, note, created_at: createdAt })

  it('locates, drops unlocatable ones, and keeps the earlier of two overlapping', () => {
    const items = [
      h('late', '人也。字', 5, '2026-11-05 10:00:02'),
      h('early', '下相人', 4, '2026-11-05 10:00:01', '批注'),
      h('gone', '不存在', 0, '2026-11-05 10:00:00'),
      h('moved', '初起时', 0, '2026-11-05 10:00:03'),
    ]
    expect(pickChapterHighlights(full, items)).toEqual([
      { id: 'early', anchor: { start: 4, end: 7 }, hasNote: true },
      { id: 'moved', anchor: { start: 12, end: 15 }, hasNote: false },
    ])
  })
})

describe('chapterContentOf', () => {
  it('finds the .chapter-content holding a node inside root, skipping PDF pages', () => {
    document.body.innerHTML = `<div id="root"><section><div class="chapter-content" id="a"><p>甲乙</p><p>丙</p></div></section>
      <div class="chapter-content pdf-chapter" id="pdf"><p>页</p></div></div><div class="chapter-content" id="outside"><p>外</p></div>`
    const root = document.getElementById('root')!
    const a = document.getElementById('a')!
    expect(chapterContentOf(a.querySelector('p')!.firstChild!, root)).toBe(a)
    expect(chapterContentOf(a, root)).toBe(a)
    expect(chapterContentOf(root.querySelector('section')!, root)).toBeNull()
    expect(chapterContentOf(document.getElementById('pdf')!.firstChild!, root)).toBeNull()
    expect(chapterContentOf(document.getElementById('outside')!.firstChild!, root)).toBeNull()
    expect(chapterContentOf(a, null)).toBeNull()
  })
})

describe('checkNewHighlight', () => {
  const located = [{ id: 'h', anchor: { start: 10, end: 20 }, hasNote: false }]
  it('rejects overlaps first, then over-long text', () => {
    expect(checkNewHighlight({ start: 0, end: 10 }, 'x'.repeat(10), located)).toBe('ok')
    expect(checkNewHighlight({ start: 15, end: 2000 }, 'x'.repeat(1985), located)).toBe('overlap')
    expect(checkNewHighlight({ start: 20, end: 1021 }, 'x'.repeat(1001), located)).toBe('too-long')
    expect(checkNewHighlight({ start: 20, end: 1020 }, 'x'.repeat(1000), located)).toBe('ok')
  })
})
