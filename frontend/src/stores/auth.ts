import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'
import type { User } from '@/types'

// 从 JWT payload 解码过期时间（毫秒），无需额外依赖
function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return (payload.exp as number) * 1000
  } catch {
    return Date.now() + 2 * 60 * 60 * 1000  // 解码失败时按 2 小时
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(localStorage.getItem('accessToken'))

  const isLoggedIn = computed(() => !!accessToken.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  // ── 主动刷新定时器 ───────────────────────────────────────────
  let refreshTimer: ReturnType<typeof setTimeout> | null = null

  function scheduleRefresh(token: string) {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    const exp = jwtExpiry(token)
    const remaining = exp - Date.now()
    // 在剩余有效期的 80% 时主动刷新（2h token → 约 96 分钟后刷新）
    const delay = remaining * 0.8
    if (delay < 60_000) return  // 剩余不足 1 分钟，不再安排（等 401 兜底）
    refreshTimer = setTimeout(async () => {
      refreshTimer = null
      await tryRefresh()
    }, delay)
  }

  function storeTokens(data: { accessToken: string; refreshToken: string }) {
    accessToken.value = data.accessToken
    localStorage.setItem('accessToken', data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
    scheduleRefresh(data.accessToken)  // 每次存入 token 时重置续期定时器
  }

  function clearTokens() {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null }
    accessToken.value = null
    user.value = null
    localStorage.removeItem('accessToken')
    localStorage.removeItem('refreshToken')
  }

  async function login(username: string, password: string) {
    const resp = await authApi.login({ username, password })
    const data = resp.data.data!
    user.value = data.user
    storeTokens(data)
  }

  async function logout() {
    try { await authApi.logout() } catch { /* ignore */ }
    clearTokens()
  }

  async function fetchMe() {
    try {
      const resp = await authApi.me()
      user.value = resp.data.data!
    } catch {
      // 不在这里清 token，让 http 拦截器的 refresh 机制处理 401
    }
  }

  // 有 refreshToken 但 accessToken 缺失或过期时，尝试静默刷新
  async function tryRefresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) return false
    try {
      const resp = await authApi.refresh(refreshToken)
      const data = resp.data.data!
      storeTokens(data)  // 刷新成功后同样重置定时器
      return true
    } catch {
      clearTokens()
      return false
    }
  }

  // 应用启动时，若 localStorage 已有 token，立即安排续期定时器
  const existingToken = localStorage.getItem('accessToken')
  if (existingToken) {
    scheduleRefresh(existingToken)
  }

  return { user, accessToken, isLoggedIn, isAdmin, login, logout, fetchMe, storeTokens, clearTokens, tryRefresh }
})
