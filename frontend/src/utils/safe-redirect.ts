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

/** 会话失效时整页跳转的登录地址（带回跳）；已在登录页则原样保留 */
export function loginHrefFor(fullPath: string): string {
  if (fullPath === '/login' || fullPath.startsWith('/login?') || fullPath.startsWith('/login#')) return fullPath
  const target = loginRedirectFor(fullPath)
  return target.query ? `/login?redirect=${encodeURIComponent(target.query.redirect)}` : '/login'
}
