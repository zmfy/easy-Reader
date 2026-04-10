import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

export function useAuth() {
  const store = useAuthStore()
  const router = useRouter()

  async function handleLogin(username: string, password: string) {
    await store.login(username, password)
    ElMessage.success('登录成功')
    router.push('/library')
  }

  async function handleLogout() {
    await store.logout()
    router.push('/login')
  }

  return { ...store, handleLogin, handleLogout }
}
