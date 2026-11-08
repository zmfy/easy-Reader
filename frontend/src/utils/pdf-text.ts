// PDF 文字层的文字规整：与后端 parser-pdf 的 buildPageText 规则一致，
// 使划下的原文可读（不重复、跨行有分隔），并与后端抽取的页文字尽量相同

export interface PdfTextItemLike { str: string; transform: number[]; hasEOL?: boolean }

const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/

/** 伪粗体（同一字符串在 1pt 内重复绘制）只保留第一个；空字符串 item 原样保留（它们携带行尾标记） */
export function dedupeTextItems<T extends PdfTextItemLike>(items: T[]): T[] {
  const byStr = new Map<string, Array<{ x: number; y: number }>>()
  return items.filter(it => {
    if (!it.str || !it.str.trim()) return true
    const x = it.transform[4]
    const y = it.transform[5]
    const same = byStr.get(it.str) || []
    if (same.some(p => Math.abs(p.x - x) < 1 && Math.abs(p.y - y) < 1)) return false
    same.push({ x, y })
    byStr.set(it.str, same)
    return true
  })
}

/** 行尾两段文字之间的分隔：任一侧为空、是 CJK 或已有空白 → 不加；否则一个空格 */
export function eolSeparator(prev: string, next: string): string {
  if (!prev || !next) return ''
  if (CJK_RE.test(prev[prev.length - 1]) || CJK_RE.test(next[0]) || /\s$/.test(prev) || /^\s/.test(next)) return ''
  return ' '
}

/** 页内有可选中的文字（去空白后非空） */
export function pageHasText(items: PdfTextItemLike[]): boolean {
  return items.some(it => !!it.str && it.str.trim() !== '')
}
