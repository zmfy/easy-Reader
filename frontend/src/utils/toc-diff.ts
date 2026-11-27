/**
 * 整理审核：把原书目录和整理版目录按标题对齐，标出合并 / 去掉 / 改名 / 新增。
 * 两份目录都按阅读顺序排列，整理版只会合并、去掉、改名或插入标题，不会打乱顺序，
 * 所以顺序扫描即可：每条整理版标题向后找第一条「像同一章」的原标题，中间跳过的原标题算去掉。
 */
export interface TocEntry { title: string; level: number }

export type TocDiffKind = 'same' | 'renamed' | 'merged' | 'removed' | 'added'

export interface TocDiffRow {
  kind: TocDiffKind
  original?: string
  organized?: string
  level: number
}

/** 向后找对应原标题的最远距离：超过它当作整理版新加的标题，免得错配到很远的同号章节 */
const LOOKAHEAD = 50

const CN_DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

function parseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  let total = 0
  let section = 0
  let digit = 0
  for (const c of s) {
    if (c in CN_DIGITS) digit = CN_DIGITS[c]
    else if (c in CN_UNITS) { section += (digit || 1) * CN_UNITS[c]; digit = 0 }
    else if (c === '万') { total += (section + digit) * 10000; section = 0; digit = 0 }
    else return null
  }
  return total + section + digit
}

interface TitleKey { num: number | null; unit: string; rest: string }

// 「第0005章X？？」→ { num: 5, unit: '章', rest: 'x' }：编号去掉前导零、中文数字换算，其余文字去掉空白和标点
function keyOf(title: string): TitleKey {
  const s = title.normalize('NFKC').toLowerCase().trim()
  const m = s.match(/^第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*([章节回集卷部篇])/)
  const num = m ? parseNumber(m[1]) : null
  const rest = (m && num !== null ? s.slice(m[0].length) : s).replace(/[\s\p{P}\p{S}]/gu, '')
  return { num, unit: m && num !== null ? m[2] : '', rest }
}

function similar(a: TitleKey, b: TitleKey): boolean {
  if (a.num !== null || b.num !== null) {
    if (a.num !== b.num || a.unit !== b.unit) return false
    return !a.rest || !b.rest || a.rest.includes(b.rest) || b.rest.includes(a.rest)
  }
  return !!a.rest && !!b.rest && (a.rest.includes(b.rest) || b.rest.includes(a.rest))
}

export function diffToc(original: TocEntry[], organized: TocEntry[]): TocDiffRow[] {
  const origKeys = original.map(e => keyOf(e.title))
  const orgKeys = organized.map(e => keyOf(e.title))
  const rows: TocDiffRow[] = []
  let i = 0
  const removeUntil = (end: number) => {
    for (; i < end; i++) rows.push({ kind: 'removed', original: original[i].title, level: original[i].level })
  }

  organized.forEach((g, j) => {
    const limit = Math.min(original.length, i + LOOKAHEAD)
    let k = i
    while (k < limit && !similar(origKeys[k], orgKeys[j])) k++
    if (k >= limit) {
      rows.push({ kind: 'added', organized: g.title, level: g.level })
      return
    }
    removeUntil(k)
    // 紧跟着的原标题也像这一章、又不像下一条整理版标题：被合并进来了
    let end = k + 1
    const next = j + 1 < organized.length ? orgKeys[j + 1] : null
    while (end < original.length && similar(origKeys[end], orgKeys[j]) && !(next && similar(origKeys[end], next))) end++
    const titles = original.slice(k, end).map(e => e.title)
    const kind: TocDiffKind = titles.length > 1 ? 'merged' : titles[0] === g.title ? 'same' : 'renamed'
    rows.push({ kind, original: titles.join(' / '), organized: g.title, level: g.level })
    i = end
  })
  removeUntil(original.length)
  return rows
}
