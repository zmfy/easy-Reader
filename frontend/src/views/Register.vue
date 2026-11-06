<template>
  <div class="auth-page">
    <div class="auth-card" :class="{ shake: hasError }">
      <div class="auth-header auth-header--center">
        <span class="auth-logo"><IconBook2 :size="24" :stroke-width="2" /></span>
        <h1 class="auth-title">{{ siteName }}</h1>
        <p class="auth-subtitle">注册新账号</p>
      </div>

      <form class="auth-form" @submit.prevent="handleSubmit">
        <label class="auth-field">
          <span>用户名</span>
          <el-input v-model="form.username" placeholder="请输入用户名（3-50字符）" size="large" :prefix-icon="IconUser" />
        </label>
        <label class="auth-field">
          <span>密码</span>
          <el-input v-model="form.password" type="password" placeholder="请输入密码（6位以上）" size="large" :prefix-icon="IconLock" show-password />
        </label>
        <label class="auth-field">
          <span>邀请码 <span class="required">*</span></span>
          <el-input v-model="form.inviteCode" placeholder="请输入邀请码" size="large" :prefix-icon="IconKey" />
        </label>

        <div v-if="errorMsg" class="auth-error">
          <IconAlertCircle :size="16" :stroke-width="2" />
          {{ errorMsg }}
        </div>

        <el-button type="primary" size="large" native-type="submit" :loading="loading" class="auth-submit">
          注 册
        </el-button>

        <div class="auth-footer">
          已有账号？
          <el-link type="primary" @click="router.push('/login')">返回登录</el-link>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { IconAlertCircle, IconBook2, IconKey, IconLock, IconUser } from '@tabler/icons-vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { authApi } from '@/api/auth'
import { settingsApi } from '@/api/settings'

const router = useRouter()
const route = useRoute()

const siteName = ref('简单书房')
const loading = ref(false)
const errorMsg = ref('')
const hasError = ref(false)

const form = reactive({
  username: '',
  password: '',
  inviteCode: '',
})

onMounted(async () => {
  const code = route.query.code as string
  if (code) form.inviteCode = code
  try {
    const resp = await settingsApi.getPublic()
    if (resp.data.data?.site_name) siteName.value = resp.data.data.site_name
  } catch { /* keep default */ }
})

async function handleSubmit() {
  if (!form.username || !form.password) {
    triggerError('请填写用户名和密码')
    return
  }
  if (!form.inviteCode) {
    triggerError('邀请码为必填项')
    return
  }

  loading.value = true
  errorMsg.value = ''

  try {
    await authApi.register({
      username: form.username,
      password: form.password,
      inviteCode: form.inviteCode,
    })
    ElMessage.success('注册成功，请登录')
    router.push('/login')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '注册失败，请重试'
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
