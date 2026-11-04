import type { ReaderTheme } from '@/types'

/**
 * 阅读器配色变量（docs/reader-style-spec.md）：
 * 外围底色 / 纸张底色 / 正文 / 次要文字 / 分隔线。
 * 「护眼绿」使用规范给定的精确值；其他阅读主题由背景色与文字色派生。
 */
export function readerPalette(theme: ReaderTheme, paperBg: string, text: string): Record<string, string> {
  if (theme === 'green-paper') {
    return {
      '--reader-page-bg': '#C9E0CB',
      '--reader-paper-bg': '#E0EEE1',
      '--reader-text': 'rgba(0,0,0,.9)',
      '--reader-text-secondary': 'rgba(0,0,0,.48)',
      '--reader-divider': 'rgba(0,0,0,.08)',
    }
  }
  return {
    // 外围比纸张略向文字色偏移：浅色主题略深、深色主题略浅
    '--reader-page-bg': `color-mix(in srgb, ${paperBg} 90%, ${text})`,
    '--reader-paper-bg': paperBg,
    '--reader-text': text,
    '--reader-text-secondary': `color-mix(in srgb, ${text} 55%, transparent)`,
    '--reader-divider': `color-mix(in srgb, ${text} 10%, transparent)`,
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[code.toLowerCase()] ?? m
  })
}

function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
}

const normalize = (s: string) => s.replace(/[\s　]+/g, '')

/**
 * 正文开头若重复了章节标题（TXT 章节内容从标题行开始、EPUB 常自带标题），
 * 给这一块加 hidden 隐藏，避免与阅读器标题区重复。只隐藏不删除，
 * 段落序号不变，按段落保存的阅读位置不受影响。
 */
export function hideLeadingTitle(html: string, title: string): string {
  const t = normalize(title || '')
  if (!t) return html
  const m = html.match(/^(\s*)<(p|h[1-6]|div)\b([^>]*)>([\s\S]*?)<\/\2>/i)
  if (!m || normalize(plainText(m[4])) !== t) return html
  const [whole, lead, tag, attrs] = m
  return `${lead}<${tag}${attrs} hidden>` + html.slice(lead.length + `<${tag}${attrs}>`.length, whole.length) + html.slice(whole.length)
}

/** 本章字数：去掉标签与空白后的可见字符数 */
export function countChapterChars(html: string): number {
  return Array.from(normalize(plainText(html))).length
}
