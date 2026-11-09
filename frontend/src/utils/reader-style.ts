import type { ReaderTheme } from '@/types'

/** 深色阅读主题（目录面板阴影加深、「夜间」按钮切回日间） */
const DARK_READER_THEMES: ReaderTheme[] = ['night', 'dark']

export function isDarkReaderTheme(theme: ReaderTheme): boolean {
  return DARK_READER_THEMES.includes(theme)
}

/** 墨水屏主题：纯黑白配色、关闭动画、点屏幕两侧瞬间翻页 */
export function isEinkTheme(theme: ReaderTheme): boolean {
  return theme === 'eink'
}

/** 工具栏「夜间」按钮：浅色主题切到夜间，深色主题切回默认的靛青 */
export function nightToggleTheme(theme: ReaderTheme): ReaderTheme {
  return isDarkReaderTheme(theme) ? 'indigo' : 'night'
}

/** 已移除的阅读主题（如旧版「护眼绿」）迁移到默认的靛青，配色一并替换 */
export function migrateReaderTheme<T extends { theme: string; backgroundColor: string; fontColor: string }>(
  settings: T,
  themes: Record<string, { backgroundColor: string; fontColor: string }>,
): T {
  if (settings.theme in themes) return settings
  const t = themes.indigo
  return { ...settings, theme: 'indigo', backgroundColor: t.backgroundColor, fontColor: t.fontColor }
}

const DARK_ON_ACCENT = '#1a2440'

function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** accent 底上的文字色：与白色、深色比对比度，取更清晰的一个；无法解析时退回白色 */
export function onAccentColor(accentHex: string): string {
  const rgb = hexToRgb(accentHex)
  if (!rgb) return '#ffffff'
  const l = luminance(rgb)
  const whiteContrast = 1.05 / (l + 0.05)
  const darkContrast = (l + 0.05) / (luminance(hexToRgb(DARK_ON_ACCENT)!) + 0.05)
  return whiteContrast >= darkContrast ? '#ffffff' : DARK_ON_ACCENT
}

/** 深色阅读主题的强调色是站点 accent 与 55:45 白色的混合（与 readerPalette 里的 color-mix 一致） */
function mixWithWhite(hex: string, ratio: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return '#' + rgb.map((v) => Math.round(v * ratio + 255 * (1 - ratio)).toString(16).padStart(2, '0')).join('')
}

/**
 * 阅读器配色变量：外围底色 / 纸张 / 正文 / 次要文字 / 分隔线，以及面板（目录、工具栏）的底色与阴影、
 * 强调色、悬停 / 按下底色。默认的「靛青」与网站靛青主题同色；其他阅读主题由背景色与文字色派生。
 * 强调色跟随网站主题的 --accent，深色阅读主题上提亮以保证对比度。
 */
export function readerPalette(theme: ReaderTheme, paperBg: string, text: string, siteAccent?: string): Record<string, string> {
  // siteAccent：站点主题 --accent 的十六进制值，用来算 accent 底上的文字色；缺省时浅色主题用站点的 --on-accent、深色主题用深色字
  const onAccent = (dark: boolean) => {
    if (!siteAccent) return dark ? DARK_ON_ACCENT : 'var(--on-accent)'
    return onAccentColor(dark ? mixWithWhite(siteAccent, 0.55) : siteAccent)
  }
  if (theme === 'indigo') {
    return {
      '--reader-page-bg': '#eef1f6',
      '--reader-paper-bg': '#ffffff',
      '--reader-text': '#1a2440',
      '--reader-text-secondary': '#8a94a6',
      '--reader-divider': '#e8ecf4',
      '--reader-panel-bg': '#ffffff',
      '--reader-panel-shadow': '0 1px 2px rgba(26,36,64,.04), 0 8px 32px rgba(26,36,64,.12)',
      '--reader-accent': 'var(--accent)',
      '--reader-on-accent': onAccent(false),
      '--reader-accent-weak': 'color-mix(in srgb, var(--accent) 10%, #ffffff)',
      '--reader-hover-bg': 'rgba(26,36,64,.04)',
      '--reader-active-bg': 'rgba(26,36,64,.07)',
      '--reader-text-2': '#4a5568',
    }
  }
  if (theme === 'eink') {
    // 墨水屏：只用纯色（墨水屏设备的浏览器可能较老，不支持 color-mix），不要阴影和半透明
    return {
      '--reader-page-bg': '#ffffff',
      '--reader-paper-bg': '#ffffff',
      '--reader-text': '#000000',
      '--reader-text-secondary': '#333333',
      '--reader-divider': '#000000',
      '--reader-panel-bg': '#ffffff',
      '--reader-panel-shadow': 'none',
      '--reader-accent': '#000000',
      '--reader-on-accent': '#ffffff',
      '--reader-accent-weak': '#e6e6e6',
      '--reader-hover-bg': '#eeeeee',
      '--reader-active-bg': '#dddddd',
      '--reader-text-2': '#222222',
    }
  }
  const dark = isDarkReaderTheme(theme)
  const accent = dark ? 'color-mix(in srgb, var(--accent) 55%, #ffffff)' : 'var(--accent)'
  return {
    // 外围比纸张略向文字色偏移：浅色主题略深、深色主题略浅
    '--reader-page-bg': `color-mix(in srgb, ${paperBg} 92%, ${text})`,
    '--reader-paper-bg': paperBg,
    '--reader-text': text,
    '--reader-text-secondary': `color-mix(in srgb, ${text} 55%, transparent)`,
    '--reader-divider': `color-mix(in srgb, ${text} 10%, transparent)`,
    '--reader-panel-bg': dark ? `color-mix(in srgb, ${paperBg} 92%, #ffffff)` : paperBg,
    '--reader-panel-shadow': dark
      ? '0 1px 2px rgba(0,0,0,.3), 0 8px 32px rgba(0,0,0,.5)'
      : '0 1px 2px rgba(0,0,0,.04), 0 8px 32px rgba(0,0,0,.12)',
    '--reader-accent': accent,
    '--reader-on-accent': onAccent(dark),
    '--reader-accent-weak': `color-mix(in srgb, ${accent} 14%, ${paperBg})`,
    '--reader-hover-bg': `color-mix(in srgb, ${text} 5%, transparent)`,
    '--reader-active-bg': `color-mix(in srgb, ${text} 9%, transparent)`,
    '--reader-text-2': `color-mix(in srgb, ${text} 78%, transparent)`,
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

/** 只有图片、没有文字的页（漫画 EPUB 每页一张图）：阅读器按一屏完整显示 */
export function isImagePage(html: string): boolean {
  return /<(img|svg|image)\b/i.test(html) && countChapterChars(html) === 0
}
