/**
 * 整理审核：把原书目录和整理版目录按标题对齐，标出合并 / 去掉 / 改名 / 新增。
 * 两份目录都按阅读顺序排列，整理版只会合并、去掉、改名或插入标题，不会打乱顺序，
 * 所以按「像同一章」做最长公共子序列对齐（目录太大时退回有限窗口的顺序扫描）；没对上的原标题算去掉、整理版标题算新增。
 */
export interface TocEntry { title: string; level: number }

export type TocDiffKind = 'same' | 'renamed' | 'merged' | 'removed' | 'added'

export interface TocDiffRow {
  kind: TocDiffKind
  original?: string
  organized?: string
  level: number
}

/** 整表对齐（n × m 的 DP 表）的格子上限：约 2500 × 2500，超过时退回顺序扫描 */
const MAX_DP_CELLS = 6_500_000
/** 顺序扫描时向后找对应标题的最远距离：超过它当作去掉 / 新加，免得错配到很远的同号章节 */
const LOOKAHEAD = 200

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

interface TitleKey {
  num: number | null
  unit: string
  rest: string
  /** 最后一个「第N章 / 节 / 回 / 集」的编号，没有时为 null */
  chapter: number | null
  /** chapter 之后的章名，去掉空白和标点 */
  name: string
  /** 去掉空白后的全文，用来判断整理版是否由原文删字所得 */
  compact: string
}

const PUNCT_RE = /[\s\p{P}\p{S}]/gu
const CHAPTER_RE = /第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*[章节回集]/g

// 「第0005章X？？」→ { num: 5, unit: '章', rest: 'x', chapter: 5, name: 'x' }：编号去掉前导零、中文数字换算，其余文字去掉空白和标点
function keyOf(title: string): TitleKey {
  const s = title.normalize('NFKC').toLowerCase().trim()
  const m = s.match(/^第\s*([0-9零〇一二两三四五六七八九十百千万]+)\s*([章节回集卷部篇])/)
  const num = m ? parseNumber(m[1]) : null
  const rest = (m && num !== null ? s.slice(m[0].length) : s).replace(PUNCT_RE, '')
  // 卷名前缀「第五卷名震一方第六百四十八章…」：按最后一个章号认章
  let chapter: number | null = null
  let name = ''
  for (const c of s.matchAll(CHAPTER_RE)) {
    const n = parseNumber(c[1])
    if (n === null) continue
    chapter = n
    name = s.slice(c.index! + c[0].length).replace(PUNCT_RE, '')
  }
  return { num, unit: m && num !== null ? m[2] : '', rest, chapter, name, compact: s.replace(/\s+/g, '') }
}

/** 去掉空白后 a 是否为 b 的子序列 */
function isSubsequence(a: string, b: string): boolean {
  const t = Array.from(a)
  let i = 0
  for (const c of b) if (i < t.length && c === t[i]) i++
  return i === t.length
}

/** 原标题 a 与整理版标题 b 是否像同一章 */
function similar(a: TitleKey, b: TitleKey): boolean {
  if (a.chapter !== null || b.chapter !== null) {
    if (a.chapter !== b.chapter) return false
    return isSubsequence(b.compact, a.compact) || a.name.includes(b.name) || b.name.includes(a.name)
  }
  if (a.num !== null || b.num !== null) {
    if (a.num !== b.num || a.unit !== b.unit) return false
    return !a.rest || !b.rest || a.rest.includes(b.rest) || b.rest.includes(a.rest)
  }
  return !!a.rest && !!b.rest && (a.rest.includes(b.rest) || b.rest.includes(a.rest))
}

/** 最长公共子序列对齐；返回 match[j] = 对上的原标题下标（-1 表示没对上）。同长度时优先对上靠前的原标题，后面重复的算合并 / 去掉 */
function alignByLcs(origKeys: TitleKey[], orgKeys: TitleKey[]): number[] {
  const n = origKeys.length
  const m = orgKeys.length
  // dp[i * (m + 1) + j]：原标题 i.. 与整理版 j.. 的最长公共子序列长度（从后往前填，回溯时从前往后取，靠前的优先）
  const w = m + 1
  const dp = new Uint16Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const skip = Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
      dp[i * w + j] = similar(origKeys[i], orgKeys[j]) ? Math.max(skip, dp[(i + 1) * w + j + 1] + 1) : skip
    }
  }
  const match = new Array<number>(m).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (similar(origKeys[i], orgKeys[j]) && dp[i * w + j] === dp[(i + 1) * w + j + 1] + 1) { match[j] = i; i++; j++ }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else j++
  }
  return match
}

/** 目录太大时的顺序扫描：两边各向后看 LOOKAHEAD 条，哪边跳得少就按哪边对齐 */
function alignByLookahead(origKeys: TitleKey[], orgKeys: TitleKey[]): number[] {
  const n = origKeys.length
  const m = orgKeys.length
  const match = new Array<number>(m).fill(-1)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    let k = i
    while (k < Math.min(n, i + LOOKAHEAD) && !similar(origKeys[k], orgKeys[j])) k++
    let l = j
    while (l < Math.min(m, j + LOOKAHEAD) && !similar(origKeys[i], orgKeys[l])) l++
    const kFound = k < Math.min(n, i + LOOKAHEAD)
    const lFound = l < Math.min(m, j + LOOKAHEAD)
    if (kFound && (!lFound || k - i <= l - j)) { match[j] = k; i = k + 1; j++ }
    else if (lFound) j++ // 整理版 j 是新加的
    else i++ // 原标题 i 在附近找不到对应：去掉
  }
  return match
}

export function diffToc(original: TocEntry[], organized: TocEntry[]): TocDiffRow[] {
  const origKeys = original.map(e => keyOf(e.title))
  const orgKeys = organized.map(e => keyOf(e.title))
  const match = (original.length + 1) * (organized.length + 1) <= MAX_DP_CELLS
    ? alignByLcs(origKeys, orgKeys)
    : alignByLookahead(origKeys, orgKeys)
  // nextMatch[j]：整理版 j 之后第一条对上的原标题下标，合并只能合并到它之前
  const nextMatch = new Array<number>(organized.length)
  for (let j = organized.length - 1, next = original.length; j >= 0; j--) {
    nextMatch[j] = next
    if (match[j] >= 0) next = match[j]
  }
  const rows: TocDiffRow[] = []
  let i = 0
  const removeUntil = (end: number) => {
    for (; i < end; i++) rows.push({ kind: 'removed', original: original[i].title, level: original[i].level })
  }

  organized.forEach((g, j) => {
    const k = match[j]
    if (k < 0) {
      rows.push({ kind: 'added', organized: g.title, level: g.level })
      return
    }
    removeUntil(k)
    // 紧跟着没对上的原标题也像这一章：被合并进来了
    let end = k + 1
    while (end < nextMatch[j] && similar(origKeys[end], orgKeys[j])) end++
    const titles = original.slice(k, end).map(e => e.title)
    const kind: TocDiffKind = titles.length > 1 ? 'merged' : titles[0] === g.title ? 'same' : 'renamed'
    rows.push({ kind, original: titles.join(' / '), organized: g.title, level: g.level })
    i = end
  })
  removeUntil(original.length)
  return rows
}
