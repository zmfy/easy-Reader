<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="bg-orb orb-1"></div>
      <div class="bg-orb orb-2"></div>
      <div class="bg-orb orb-3"></div>
    </div>

    <div class="login-container">
      <div class="login-card" :class="{ 'shake': hasError }">
        <div class="card-header">
          <div class="brand-icon">📖</div>
          <h1 class="brand-title">{{ siteName }}</h1>
          <p class="brand-subtitle">{{ siteSubtitle }}</p>
        </div>

        <form class="login-form" @submit.prevent="handleSubmit">
          <div class="field-group">
            <label class="field-label">用户名</label>
            <el-input
              v-model="form.username"
              placeholder="请输入用户名"
              size="large"
              :prefix-icon="User"
            />
          </div>
          <div class="field-group">
            <label class="field-label">密码</label>
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码"
              size="large"
              :prefix-icon="Lock"
              show-password
            />
          </div>

          <div v-if="errorMsg" class="error-msg">
            <el-icon><Warning /></el-icon>
            {{ errorMsg }}
          </div>

          <el-button
            type="primary"
            size="large"
            native-type="submit"
            :loading="loading"
            class="submit-btn"
          >
            登 录
          </el-button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { User, Lock, Warning } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { settingsApi } from '@/api/settings'

const authStore = useAuthStore()
const router = useRouter()

const siteName = ref('夜航书房')
const siteSubtitle = ref('Night Reader · NAS Novel Platform')
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
    ElMessage.success('欢迎回来，' + form.username)
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

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-0);
  position: relative;
  overflow: hidden;
}

.login-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.15;
}

.orb-1 {
  width: 600px; height: 600px;
  background: var(--accent);
  top: -20%; left: -10%;
  animation: float 8s ease-in-out infinite;
}

.orb-2 {
  width: 400px; height: 400px;
  background: var(--accent-2);
  bottom: -10%; right: -5%;
  animation: float 10s ease-in-out infinite reverse;
}

.orb-3 {
  width: 300px; height: 300px;
  background: var(--warning);
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  animation: float 12s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-20px); }
}

.login-container {
  position: relative;
  z-index: 1;
  animation: slideUp 0.4s ease forwards;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

.login-card {
  width: 400px;
  background: var(--card-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  padding: 40px;
  box-shadow: var(--shadow-soft);
  transition: transform 0.1s ease;
}

.login-card.shake {
  animation: shake 0.5s ease;
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}

.card-header {
  text-align: center;
  margin-bottom: 28px;
}

.brand-icon {
  font-size: 40px;
  margin-bottom: 12px;
  display: block;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
}

.brand-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--card-title);
  letter-spacing: 3px;
  margin-bottom: 6px;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.brand-subtitle {
  font-size: 12px;
  color: var(--text-2);
  letter-spacing: 1px;
}


.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
}

.optional {
  color: var(--text-2);
  font-size: 11px;
  font-weight: normal;
}

.error-msg {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(255, 107, 138, 0.1);
  border: 1px solid rgba(255, 107, 138, 0.3);
  border-radius: var(--radius-md);
  color: var(--danger);
  font-size: 13px;
}

.submit-btn {
  width: 100%;
  height: 48px;
  font-size: 16px;
  letter-spacing: 2px;
  font-weight: 600;
  border-radius: var(--radius-md) !important;
  background: var(--accent) !important;
  border: none !important;
  margin-top: 4px;
  transition: all 0.2s ease !important;
}

.submit-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(124, 92, 255, 0.4);
}

</style>
