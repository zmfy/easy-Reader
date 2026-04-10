import axios from 'axios'
import type { AxiosInstance } from 'axios'

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

// Response interceptor: handle 401
http.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('accessToken')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default http
