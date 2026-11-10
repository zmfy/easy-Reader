// 后端时间多来自 SQLite 的 CURRENT_TIMESTAMP：不带时区的 UTC 字符串（"YYYY-MM-DD HH:MM:SS"）。
// 直接 new Date() 会被当成本地时间解析（东八区差 8 小时），Safari 还会解析失败得到 NaN。
const SQLITE_UTC = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/

export function parseServerTime(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = SQLITE_UTC.exec(value)
  const d = new Date(m ? `${m[1]}T${m[2]}Z` : value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 以本地时区显示后端时间；无法解析时原样返回 */
export function formatServerTime(value: string | null | undefined, mode: 'datetime' | 'date' = 'datetime'): string {
  const d = parseServerTime(value)
  if (!d) return value ?? ''
  return mode === 'date' ? d.toLocaleDateString('zh-CN') : d.toLocaleString('zh-CN', { hour12: false })
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / 昨天 / N 天前，一周以上显示日期 */
export function relativeTime(value: string | null | undefined, now: Date = new Date()): string {
  const d = parseServerTime(value)
  if (!d) return value ?? ''
  const sec = Math.max(0, (now.getTime() - d.getTime()) / 1000)
  if (sec < 60) return '刚刚'
  if (sec < 3600) return `${Math.floor(sec / 60)} 分钟前`
  if (sec < 86400) return `${Math.floor(sec / 3600)} 小时前`
  const days = Math.floor(sec / 86400)
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString('zh-CN')
}
