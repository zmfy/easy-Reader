import { parseServerTime } from './time'

/** 隔几天没读就提示「前情提要」 */
export const RECAP_AFTER_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** 距后端时间（SQLite UTC 字符串）过去的整天数；无法解析时返回 null */
export function daysSince(value: string | null | undefined, now = new Date()): number | null {
  const d = parseServerTime(value)
  return d ? Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS)) : null
}

export function shouldOfferRecap(
  progress: { hasProgress?: boolean; updatedAt?: string | null },
  aiReady: boolean,
  now = new Date(),
): boolean {
  if (!aiReady || !progress.hasProgress) return false
  const days = daysSince(progress.updatedAt, now)
  return days !== null && days >= RECAP_AFTER_DAYS
}

export function awayLabel(days: number): string {
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  if (days < 365) return `${Math.floor(days / 30)} 个多月前`
  return `${Math.floor(days / 365)} 年多前`
}

export interface AskMessage {
  role: 'user' | 'ai'
  text: string
  sources?: Array<{ chapterIndex: number; title: string }>
  pending?: boolean
  error?: boolean
}

/** 问书带给 AI 的历史：已成功回答的问答对，最近 3 轮 */
export function askHistory(messages: AskMessage[], max = 3): Array<{ q: string; a: string }> {
  const pairs: Array<{ q: string; a: string }> = []
  for (let i = 0; i + 1 < messages.length; i++) {
    const q = messages[i], a = messages[i + 1]
    if (q.role === 'user' && a.role === 'ai' && !a.error && !a.pending && a.text) pairs.push({ q: q.text, a: a.text })
  }
  return pairs.slice(-max)
}
