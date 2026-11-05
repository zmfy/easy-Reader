<template>
  <div class="pwd-page">
    <div class="pwd-card">
      <div class="pwd-header">
        <span class="pwd-icon"><IconKey :size="22" :stroke-width="1.75" /></span>
        <h1>{{ forced ? '请先修改默认密码' : '修改密码' }}</h1>
        <p v-if="forced" class="pwd-tip">
          当前账号仍在使用初始密码，修改后才能继续使用。修改后，此账号在其他设备上的登录会失效。
        </p>
        <p v-else class="pwd-tip">修改后，此账号在其他设备上的登录会失效，需要重新登录。</p>
      </div>

      <form class="pwd-form" @submit.prevent="submit">
        <label class="field">
          <span>当前密码</span>
          <el-input v-model="form.current" type="password" show-password autocomplete="current-password" placeholder="请输入当前密码" />
        </label>
        <label class="field">
          <span>新密码</span>
          <el-input v-model="form.next" type="password" show-password autocomplete="new-password" placeholder="请输入新密码" />
        </label>
        <label class="field">
          <span>确认新密码</span>
          <el-input v-model="form.confirm" type="password" show-password autocomplete="new-password" placeholder="再次输入新密码" />
        </label>

        <ul class="rules">
          <li v-for="r in ruleList" :key="r.key" :class="rules[r.key] ? 'pass' : 'fail'">
            <span class="rule-icon">{{ rules[r.key] ? '✓' : '✗' }}</span>{{ r.label }}
          </li>
        </ul>

        <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

        <div class="actions">
          <el-button v-if="forced" @click="logout">退出登录</el-button>
          <el-button v-else @click="goBack">返回</el-button>
          <el-button type="primary" native-type="submit" :loading="loading" :disabled="!canSubmit">确认修改</el-button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { IconKey } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { passwordRules, passwordValid, type PasswordRules } from '@/utils/password-policy'

const authStore = useAuthStore()
const router = useRouter()

const forced = computed(() => !!authStore.user?.mustChangePassword)
const form = reactive({ current: '', next: '', confirm: '' })
const loading = ref(false)
const errorMsg = ref('')

const rules = computed(() => passwordRules(form.next, form.confirm))
const ruleList: Array<{ key: keyof PasswordRules; label: string }> = [
  { key: 'minLen', label: '至少 8 位' },
  { key: 'hasUpper', label: '至少 1 个大写字母' },
  { key: 'hasLower', label: '至少 1 个小写字母' },
  { key: 'hasNumber', label: '至少 1 个数字' },
  { key: 'hasSpecial', label: '至少 1 个特殊字符（如 !@#$%^&*）' },
  { key: 'matched', label: '两次密码一致' },
]
const canSubmit = computed(() => !!form.current && passwordValid(rules.value))

async function submit() {
  if (!canSubmit.value || loading.value) return
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.changePassword(form.current, form.next)
    ElMessage.success('密码已修改')
    router.replace('/library')
  } catch (err: unknown) {
    errorMsg.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '修改失败，请重试'
  } finally {
    loading.value = false
  }
}

function goBack() {
  if (window.history.length > 1) router.back()
  else router.replace('/library')
}

async function logout() {
  await authStore.logout()
  router.replace('/login')
}
</script>

<style scoped>
.pwd-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: var(--bg-0);
}

.pwd-card {
  width: 100%;
  max-width: 440px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 32px;
}

.pwd-header { margin-bottom: 20px; }

.pwd-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.pwd-header h1 {
  margin: 12px 0 6px;
  font-size: 20px;
  color: var(--text-0);
}

.pwd-tip {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-2);
}

.pwd-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--text-1);
}

.rules {
  list-style: none;
  margin: 0;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-2);
  border-radius: var(--radius-md);
  font-size: 13px;
}

.rules li { display: flex; align-items: center; gap: 8px; transition: color 0.2s ease; }
.rules li.pass { color: #22c55e; }
.rules li.fail { color: var(--text-2); }
.rule-icon { width: 14px; font-size: 12px; font-weight: 700; flex-shrink: 0; }

.error-msg {
  font-size: 13px;
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

@media (max-width: 480px) {
  .pwd-card { padding: 24px 18px; }
}
</style>
