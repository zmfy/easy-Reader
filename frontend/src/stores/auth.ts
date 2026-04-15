import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(sessionStorage.getItem('accessToken'))

  const isLoggedIn = computed(() => !!accessToken.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  function storeTokens(data: { accessToken: string; refreshToken: string }) {
    accessToken.value = data.accessToken
    sessionStorage.setItem('accessToken', data.accessToken)
    localStorage.setItem('refreshToken', data.refreshToken)
  }

  function clearTokens() {
    accessToken.value = null
    user.value = null
    sessionStorage.removeItem('accessToken')
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
      clearTokens()
    }
  }

  return { user, accessToken, isLoggedIn, isAdmin, login, logout, fetchMe, storeTokens, clearTokens }
})
