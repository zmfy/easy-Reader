// 划线锚点：偏移均为 content.textContent 中的 [start, end)

export interface TextAnchor { start: number; end: number }

/** 选区 → 锚点；去首尾空白；选区不完全在 content 内、或去空白后为空 → null */
export function rangeToAnchor(content: HTMLElement, range: Range): { anchor: TextAnchor; text: string } | null {
  if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(content)
  pre.setEnd(range.startContainer, range.startOffset)
  const rawStart = pre.toString().length
  const raw = range.toString()
  const text = raw.trim()
  if (!text) return null
  const lead = raw.length - raw.trimStart().length
  const start = rawStart + lead
  return { anchor: { start, end: start + text.length }, text }
}

/** 存储的偏移若仍对应 text 则原样返回；否则在 fullText 中找 text，取离原 start 最近的一处；找不到 → null */
export function locateHighlight(fullText: string, stored: TextAnchor & { text: string }): TextAnchor | null {
  const { text } = stored
  if (!text) return null
  if (fullText.slice(stored.start, stored.end) === text) return { start: stored.start, end: stored.end }
  let best = -1
  let idx = fullText.indexOf(text)
  while (idx !== -1) {
    if (best === -1 || Math.abs(idx - stored.start) < Math.abs(best - stored.start)) best = idx
    idx = fullText.indexOf(text, idx + 1)
  }
  return best === -1 ? null : { start: best, end: best + text.length }
}

/** 半开区间，相邻不算重叠 */
export function overlaps(a: TextAnchor, b: TextAnchor): boolean {
  return a.start < b.end && b.start < a.end
}

/** 拆掉 mark.hl 并合并相邻文本节点 */
export function clearHighlights(content: HTMLElement): void {
  content.querySelectorAll('mark.hl').forEach(mark => {
    const parent = mark.parentNode
    if (!parent) return
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  })
  content.normalize()
}

// 这些元素的直接子节点里的纯空白只是排版换行，不能包 mark
const STRUCTURAL_TAGS = new Set(['UL', 'OL', 'DL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP'])

// 把正文中 [start, end) 的文本逐个文本节点包进 makeMark() 创建的元素，返回这些元素
function wrapTextRange(content: HTMLElement, { start, end }: TextAnchor, makeMark: () => HTMLElement): HTMLElement[] {
  if (end <= start) return []
  // 先收集相交文本节点，再统一修改，避免遍历中改树
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
  const hits: Array<{ node: Text; from: number; to: number }> = []
  let pos = 0
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const len = n.data.length
    const from = Math.max(start, pos) - pos
    const to = Math.min(end, pos + len) - pos
    // 纯空白节点若不在行内元素里（ul/tr/段落之间的换行），包 mark 会破坏结构，跳过
    const skip = !n.data.trim() && (n.parentElement === content || STRUCTURAL_TAGS.has(n.parentElement?.tagName ?? ''))
    if (from < to && !skip) hits.push({ node: n, from, to })
    pos += len
    if (pos >= end) break
  }
  return hits.map(({ node, from, to }) => {
    let target = node
    if (from > 0) target = target.splitText(from)
    if (to - from < target.data.length) target.splitText(to - from)
    const mark = makeMark()
    target.parentNode!.insertBefore(mark, target)
    mark.appendChild(target)
    return mark
  })
}

/** 先清除已有 mark.hl，再按 items 包裹；每段文本节点包成 <mark class="hl" data-hl-id>，有批注的加 has-note */
export function applyHighlights(
  content: HTMLElement,
  items: Array<{ id: string; anchor: TextAnchor; hasNote: boolean }>,
): void {
  clearHighlights(content)
  for (const item of items) {
    wrapTextRange(content, item.anchor, () => {
      const mark = document.createElement('mark')
      mark.className = item.hasNote ? 'hl has-note' : 'hl'
      mark.dataset.hlId = item.id
      return mark
    })
  }
}

/** 跳原文：把正文中 label（去首尾空白）首次出现处包进 <mark class="src-flash">；找不到返回 [] */
export function flashText(content: HTMLElement, label: string): HTMLElement[] {
  const needle = label.trim()
  if (!needle) return []
  const start = (content.textContent || '').indexOf(needle)
  if (start < 0) return []
  return wrapTextRange(content, { start, end: start + needle.length }, () => {
    const mark = document.createElement('mark')
    mark.className = 'src-flash'
    return mark
  })
}

/** 拆掉 flashText 加的包裹并合并文本节点（划线 mark 不受影响） */
export function unwrapMarks(content: HTMLElement, marks: HTMLElement[]): void {
  for (const mark of marks) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  content.normalize()
}

/**
 * 本章要渲染的划线：按创建先后逐条定位，定位不到的、与先创建的重叠的丢弃（避免嵌套 mark）；
 * 返回结果按位置排序，供 applyHighlights 与新选区的重叠检查共用
 */
export function pickChapterHighlights(
  fullText: string,
  stored: Array<{ id: string; start_offset: number; end_offset: number; text: string; note: string | null; created_at: string }>,
): Array<{ id: string; anchor: TextAnchor; hasNote: boolean }> {
  const accepted: Array<{ id: string; anchor: TextAnchor; hasNote: boolean }> = []
  const byCreation = [...stored].sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
  for (const h of byCreation) {
    const anchor = locateHighlight(fullText, { start: h.start_offset, end: h.end_offset, text: h.text })
    if (!anchor || accepted.some(a => overlaps(a.anchor, anchor))) continue
    accepted.push({ id: h.id, anchor, hasNote: !!h.note })
  }
  return accepted.sort((a, b) => a.anchor.start - b.anchor.start)
}

/** 节点所在的划线正文容器（root 内、非 PDF 页的 .chapter-content）；选区跨章或在正文外 → null */
export function chapterContentOf(node: Node, root: Element | null): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  const content = el?.closest<HTMLElement>('.chapter-content')
  if (!content || !root?.contains(content) || content.classList.contains('pdf-chapter')) return null
  return content
}

export const MAX_HIGHLIGHT_CHARS = 1000

/** 新选区能否划线：与本章已定位的划线重叠 → 'overlap'；超过 1000 字 → 'too-long' */
export function checkNewHighlight(
  anchor: TextAnchor, text: string, located: Array<{ anchor: TextAnchor }>,
): 'ok' | 'overlap' | 'too-long' {
  if (located.some(h => overlaps(h.anchor, anchor))) return 'overlap'
  if (text.length > MAX_HIGHLIGHT_CHARS) return 'too-long'
  return 'ok'
}
