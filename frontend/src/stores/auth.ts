import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi } from '@/api/auth'
import type { User } from '@/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const accessToken = ref<string | null>(sessionStorage.getItem('accessToken'))

  const isLoggedIn = computed(() => !!accessToken.value)
  const isAdmin = computed(() => user.value?.role === 'admin')

  async function login(username: string, password: string) {
    const resp = await authApi.login({ username, password })
    const data = resp.data.data!
    accessToken.value = data.accessToken
    user.value = data.user
    sessionStorage.setItem('accessToken', data.accessToken)
  }

  async function logout() {
    try { await authApi.logout() } catch { /* ignore */ }
    accessToken.value = null
    user.value = null
    sessionStorage.removeItem('accessToken')
  }

  async function fetchMe() {
    try {
      const resp = await authApi.me()
      user.value = resp.data.data!
    } catch {
      accessToken.value = null
      user.value = null
      sessionStorage.removeItem('accessToken')
    }
  }

  return { user, accessToken, isLoggedIn, isAdmin, login, logout, fetchMe }
})
