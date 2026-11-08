import axios from 'axios'
import { isNetworkFailure, reportNetworkError, reportNetworkOk } from '@/utils/network-status'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach access token
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 防止并发 401 时多次触发 refresh
let refreshPromise: Promise<string> | null = null

async function doRefresh(): Promise<string> {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) throw new Error('no refresh token')
  const resp = await axios.post('/api/auth/refresh', { refreshToken })
  const data = resp.data?.data
  if (!data?.accessToken) throw new Error('refresh failed')

  localStorage.setItem('accessToken', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)

  // 同步更新 Pinia store（避免 store 与 localStorage 状态不一致）
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    authStore.storeTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken })
  } catch { /* store 未初始化时忽略 */ }

  return data.accessToken
}

/**
 * 刷新失败是否因为令牌本身无效（应退出登录）。
 * 断网、服务端 5xx、限流 429 等临时错误返回 false：保留会话，稍后可重试。
 */
export function isAuthRejection(err: unknown): boolean {
  if (err instanceof Error && (err.message === 'no refresh token' || err.message === 'refresh failed')) return true
  return axios.isAxiosError(err) && err.response?.status === 401
}

function redirectToLogin(): void {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

// Response interceptor: 401 时尝试 refresh-token 静默续期；失败再跳 /login
http.interceptors.response.use(
  (response) => {
    reportNetworkOk()
    return response
  },
  async (error) => {
    // 「没有网络连接」提示：没拿到响应 → 显示；拿到任何响应（含错误码）→ 服务器可达
    if (isNetworkFailure(error)) reportNetworkError()
    else if (error.response) reportNetworkOk()
    // 账号仍在使用默认密码：后端拒绝除改密码外的请求，转到改密码页
    if (error.response?.status === 403 && error.response.data?.code === 'AUTH_PASSWORD_CHANGE_REQUIRED') {
      if (window.location.pathname !== '/change-password') window.location.href = '/change-password'
      return Promise.reject(error)
    }
    const config = error.config as InternalAxiosRequestConfig & { _retried?: boolean }
    const is401 = error.response?.status === 401
    const isRefreshUrl = config?.url?.includes('/auth/refresh')

    if (is401 && !config?._retried && !isRefreshUrl) {
      config._retried = true
      try {
        if (!refreshPromise) {
          refreshPromise = doRefresh().finally(() => { refreshPromise = null })
        }
        const newToken = await refreshPromise
        config.headers.Authorization = `Bearer ${newToken}`
        return http(config)
      } catch (refreshErr) {
        // 仅在刷新令牌确实无效时退出；临时故障只让本次请求失败
        if (isAuthRejection(refreshErr)) redirectToLogin()
      }
    } else if (is401) {
      redirectToLogin()
    }
    return Promise.reject(error)
  }
)

export default http
