<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-header">
        <span v-if="!forced" class="pwd-icon"><IconKey :size="22" :stroke-width="1.75" /></span>
        <h1 class="auth-title">{{ forced ? '设置新密码' : '修改密码' }}</h1>
        <p v-if="!forced" class="auth-subtitle">修改后，此账号在其他设备上的登录会失效，需要重新登录。</p>
      </div>

      <!-- 默认密码账号：说明为什么必须改、改了会怎样，避免老用户以为出了故障 -->
      <div v-if="forced" class="notice" role="alert">
        <div class="notice-head">
          <span class="notice-icon"><IconShieldLock :size="18" :stroke-width="1.75" /></span>
          <span class="notice-title">为了安全，需要先设置一个新密码</span>
        </div>
        <p>你正在使用系统的初始密码 <code>admin123</code>，这个密码是公开的，任何能访问到这台 NAS 的人都能用它登录。</p>
        <ul>
          <li><IconCheck :size="15" :stroke-width="2.25" />只需设置一次，之后用新密码登录</li>
          <li><IconCheck :size="15" :stroke-width="2.25" />书库、书架、阅读进度和书签都不受影响</li>
          <li><IconCheck :size="15" :stroke-width="2.25" />其他设备上的登录会失效，用新密码重新登录即可</li>
        </ul>
      </div>

      <form class="auth-form" @submit.prevent="submit">
        <label v-if="!currentPrefilled" class="auth-field">
          <span>当前密码</span>
          <el-input size="large" v-model="form.current" type="password" show-password autocomplete="current-password" placeholder="请输入当前密码" />
        </label>
        <label class="auth-field">
          <span>新密码</span>
          <el-input size="large" v-model="form.next" type="password" show-password autocomplete="new-password" placeholder="请输入新密码" />
        </label>
        <label class="auth-field">
          <span>确认新密码</span>
          <el-input size="large" v-model="form.confirm" type="password" show-password autocomplete="new-password" placeholder="再次输入新密码" />
        </label>

        <ul class="rules">
          <li v-for="r in ruleList" :key="r.key" :class="rules[r.key] ? 'pass' : 'fail'">
            <component :is="rules[r.key] ? IconCheck : IconX" :size="14" :stroke-width="2.5" class="rule-icon" />{{ r.label }}
          </li>
        </ul>

        <div v-if="errorMsg" class="auth-error">{{ errorMsg }}</div>

        <div class="actions">
          <el-button v-if="forced" size="large" @click="logout">退出登录</el-button>
          <el-button v-else size="large" @click="goBack">返回</el-button>
          <el-button type="primary" size="large" native-type="submit" :loading="loading" :disabled="!canSubmit">确认修改</el-button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { IconCheck, IconKey, IconShieldLock, IconX } from '@tabler/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { passwordRules, passwordValid, type PasswordRules } from '@/utils/password-policy'

const authStore = useAuthStore()
const router = useRouter()

const forced = computed(() => !!authStore.user?.mustChangePassword)
// 刚用默认密码登录时，当前密码就是刚输入的那个，不必再填（刷新页面后没有，则显示输入框）
const currentPrefilled = ref(!!authStore.pendingCurrentPassword)
const form = reactive({ current: authStore.pendingCurrentPassword ?? '', next: '', confirm: '' })
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
  const wasForced = forced.value
  try {
    await authStore.changePassword(form.current, form.next)
    ElMessage.success(wasForced ? '新密码已设置，下次请用新密码登录' : '密码已修改')
    router.replace('/library')
  } catch (err: unknown) {
    errorMsg.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '修改失败，请重试'
    // 带过来的当前密码不对（极少见，如别处刚改过密码）：显示输入框让用户自己填
    if (errorMsg.value === '当前密码不正确') { currentPrefilled.value = false; form.current = '' }
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
.pwd-icon {
  margin-bottom: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.notice {
  margin-bottom: 22px;
  padding: 16px;
  border-radius: var(--radius-md);
  /* 颜色全部取自当前主题：主色 --accent 淡铺底色，文字用主题文字色 */
  background: color-mix(in srgb, var(--accent) 7%, var(--card-bg));
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--card-border));
}

.notice-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.notice-icon {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.notice-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--card-title);
}

.notice p {
  margin: 10px 0 8px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-1);
}

.notice code {
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.notice ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: var(--text-1);
}

.notice li { display: flex; align-items: flex-start; gap: 6px; line-height: 1.6; }
.notice li svg { flex: none; margin-top: 3px; color: var(--accent); }

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
.rules li.pass { color: var(--success); }
.rules li.fail { color: var(--text-2); }
.rule-icon { flex: none; }

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
