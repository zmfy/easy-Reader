import axios from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const http: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Request interceptor: attach access token
http.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('accessToken')
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
  sessionStorage.setItem('accessToken', data.accessToken)
  localStorage.setItem('refreshToken', data.refreshToken)
  return data.accessToken
}

// Response interceptor: on 401 try refresh once, then redirect to login
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
        sessionStorage.removeItem('accessToken')
        localStorage.removeItem('refreshToken')
        window.location.href = '/login'
      }
    } else if (is401) {
      sessionStorage.removeItem('accessToken')
      localStorage.removeItem('refreshToken')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default http
