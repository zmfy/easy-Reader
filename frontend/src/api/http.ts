import axios from 'axios'
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

function redirectToLogin(): void {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
  if (window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

// Response interceptor: 401 时尝试 refresh-token 静默续期；失败再跳 /login
http.interceptors.response.use(
  (response) => response,
  async (error) => {
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
      } catch {
        redirectToLogin()
      }
    } else if (is401) {
      redirectToLogin()
    }
    return Promise.reject(error)
  }
)

export default http
