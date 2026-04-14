<template>
  <div class="register-page">
    <div class="login-bg">
      <div class="bg-orb orb-1"></div>
      <div class="bg-orb orb-2"></div>
      <div class="bg-orb orb-3"></div>
    </div>

    <div class="login-container">
      <div class="login-card" :class="{ shake: hasError }">
        <div class="card-header">
          <div class="brand-icon">📖</div>
          <h1 class="brand-title">{{ siteName }}</h1>
          <p class="brand-subtitle">注册新账号</p>
        </div>

        <form class="login-form" @submit.prevent="handleSubmit">
          <div class="field-group">
            <label class="field-label">用户名</label>
            <el-input
              v-model="form.username"
              placeholder="请输入用户名（3-50字符）"
              size="large"
              :prefix-icon="User"
            />
          </div>
          <div class="field-group">
            <label class="field-label">密码</label>
            <el-input
              v-model="form.password"
              type="password"
              placeholder="请输入密码（6位以上）"
              size="large"
              :prefix-icon="Lock"
              show-password
            />
          </div>
          <div class="field-group">
            <label class="field-label">邀请码 <span class="required">*</span></label>
            <el-input
              v-model="form.inviteCode"
              placeholder="请输入邀请码"
              size="large"
              :prefix-icon="Key"
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
            注 册
          </el-button>

          <div class="login-link">
            已有账号？
            <el-link type="primary" @click="router.push('/login')">返回登录</el-link>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { User, Lock, Key, Warning } from '@element-plus/icons-vue'
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

<style scoped>
.register-page {
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
  width: 100%;
  max-width: 440px;
  padding: 0 20px;
  animation: slideUp 0.4s ease forwards;
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}

.login-card {
  width: 100%;
  background: var(--card-bg);
  backdrop-filter: blur(20px);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  padding: 40px;
  box-shadow: var(--shadow-soft);
  transition: transform 0.1s ease;
}

@media (max-width: 480px) {
  .register-page {
    align-items: center;
    padding: 32px 0;
    min-height: 100dvh;
  }
  .login-container {
    padding: 0 16px;
  }
  .login-card {
    padding: 28px 20px;
    border-radius: 16px;
  }
  .brand-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }
  .brand-title {
    font-size: 22px;
    letter-spacing: 2px;
  }
  .card-header {
    margin-bottom: 20px;
  }
  .login-form {
    gap: 12px;
  }
  .submit-btn {
    height: 44px !important;
    font-size: 15px !important;
  }
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

.required {
  color: var(--danger);
  font-size: 12px;
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

.login-link {
  text-align: center;
  font-size: 13px;
  color: var(--text-2);
}
</style>
