// 站点主题：data-theme 决定配色（main.css）；深色主题同时给 <html> 加 dark 类，
// 让 Element Plus 组件（按钮、下拉框、弹窗等）切换为深色，不再出现刺眼的白色控件
export const DEFAULT_THEME = 'indigo'   // 靛青：浅色、白卡片、靛蓝主色（默认）
const DARK_THEMES = new Set(['dark', 'warm', 'cool'])

export function isDarkTheme(theme?: string | null): boolean {
  return DARK_THEMES.has(theme || DEFAULT_THEME)
}

export function applySiteTheme(theme?: string | null): void {
  const root = document.documentElement
  root.dataset.theme = theme || DEFAULT_THEME
  root.classList.toggle('dark', isDarkTheme(theme))
}
