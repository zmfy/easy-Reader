// PageHeader 返回按钮的行为：back=字符串 → 跳转该路径；back=true → 有站内历史则回退，
// 否则有 fallback 就跳 fallback（按钮照常显示），没有则不显示
export type BackAction = { type: 'push'; path: string } | { type: 'back' } | null

export function resolveBack(back: string | boolean | undefined, hasHistory: boolean, fallback?: string): BackAction {
  if (typeof back === 'string') return back !== '' ? { type: 'push', path: back } : null
  if (back !== true) return null
  if (hasHistory) return { type: 'back' }
  return fallback ? { type: 'push', path: fallback } : null
}
