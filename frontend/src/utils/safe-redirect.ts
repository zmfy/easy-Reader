// 登录回跳：只接受站内路径，防止 ?redirect= 被用来跳到外部网站
const DEFAULT_AFTER_LOGIN = '/library'

export function safeRedirect(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return DEFAULT_AFTER_LOGIN
  return raw
}

/** 未登录访问 fullPath 时的登录地址：默认落点本身不必带回跳参数 */
export function loginRedirectFor(fullPath: string): { path: '/login'; query?: { redirect: string } } {
  if (fullPath === '/' || fullPath === DEFAULT_AFTER_LOGIN) return { path: '/login' }
  return { path: '/login', query: { redirect: fullPath } }
}
