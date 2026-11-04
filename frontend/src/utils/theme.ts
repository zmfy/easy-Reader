// 站点主题：data-theme 决定配色（main.css）；深色主题同时给 <html> 加 dark 类，
// 让 Element Plus 组件（按钮、下拉框、弹窗等）切换为深色，不再出现刺眼的白色控件
const LIGHT_THEMES = new Set(['sky', 'paper'])

export function isDarkTheme(theme?: string | null): boolean {
  return !LIGHT_THEMES.has(theme || 'dark')
}

export function applySiteTheme(theme?: string | null): void {
  const root = document.documentElement
  root.dataset.theme = theme || 'dark'
  root.classList.toggle('dark', isDarkTheme(theme))
}
