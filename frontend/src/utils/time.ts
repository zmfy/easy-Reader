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
