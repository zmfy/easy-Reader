<template>
  <div class="auth-page">
    <div class="auth-card" :class="{ shake: hasError }">
      <div class="auth-header auth-header--center">
        <span class="auth-logo"><IconBook2 :size="24" :stroke-width="2" /></span>
        <h1 class="auth-title">{{ siteName }}</h1>
        <p class="auth-subtitle">{{ siteSubtitle }}</p>
      </div>

      <form class="auth-form" @submit.prevent="handleSubmit">
        <label class="auth-field">
          <span>用户名</span>
          <el-input v-model="form.username" placeholder="请输入用户名" size="large" :prefix-icon="User" />
        </label>
        <label class="auth-field">
          <span>密码</span>
          <el-input v-model="form.password" type="password" placeholder="请输入密码" size="large" :prefix-icon="Lock" show-password />
        </label>

        <div v-if="errorMsg" class="auth-error">
          <IconAlertCircle :size="16" :stroke-width="2" />
          {{ errorMsg }}
        </div>

        <el-button type="primary" size="large" native-type="submit" :loading="loading" class="auth-submit">
          登 录
        </el-button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { User, Lock } from '@element-plus/icons-vue'
import { IconAlertCircle, IconBook2 } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { settingsApi } from '@/api/settings'

const authStore = useAuthStore()
const router = useRouter()

const siteName = ref('简单书房')
const siteSubtitle = ref('Easy Reader · NAS Novel Platform')
const loading = ref(false)

onMounted(async () => {
  try {
    const resp = await settingsApi.getPublic()
    if (resp.data.data?.site_name) siteName.value = resp.data.data.site_name
    if (resp.data.data?.site_subtitle) siteSubtitle.value = resp.data.data.site_subtitle
  } catch { /* keep default */ }
})
const errorMsg = ref('')
const hasError = ref(false)

const form = reactive({
  username: '',
  password: '',
})

async function handleSubmit() {
  if (!form.username || !form.password) {
    triggerError('请填写用户名和密码')
    return
  }

  loading.value = true
  errorMsg.value = ''

  try {
    await authStore.login(form.username, form.password)
    // 默认密码账号会被带到设置新密码页，那里有说明，不再弹「欢迎回来」
    if (!authStore.user?.mustChangePassword) ElMessage.success('欢迎回来，' + form.username)
    router.push('/library')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '登录失败，请重试'
    triggerError(msg)
  } finally {
    loading.value = false
  }
}

function triggerError(msg: string) {
  errorMsg.value = msg
  hasError.value = true
  setTimeout(() => { hasError.value = false }, 600)
}
</script>
