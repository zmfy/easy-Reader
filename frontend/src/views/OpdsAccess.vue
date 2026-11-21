<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="阅读 App（OPDS）" />

      <section class="section-card">
        <h2 class="section-title">在阅读 App 里看书</h2>
        <p class="section-desc">
          在 KOReader、KyBook、Yomu、静读天下（Moon+ Reader）等 App 里添加「OPDS 书目」，填写下面的地址、用户名和 OPDS 密码，
          就能浏览、搜索书库并下载到设备上阅读。TXT / UMD 会自动转成 EPUB 下载。
        </p>

        <div v-if="isHttp" class="http-warning" role="alert">
          当前通过 HTTP 访问，密码会明文传输；在外网请使用 HTTPS 地址。
        </div>

        <dl class="opds-fields">
          <dt>书目地址</dt>
          <dd>
            <code>{{ feedUrl }}</code>
            <el-button size="small" link type="primary" @click="copy(feedUrl, '地址已复制')">复制</el-button>
          </dd>
          <dt>用户名</dt>
          <dd><code>{{ status?.username }}</code></dd>
          <dt>OPDS 密码</dt>
          <dd v-if="newPassword">
            <code class="opds-password">{{ newPassword }}</code>
            <el-button size="small" link type="primary" @click="copy(newPassword, '密码已复制')">复制</el-button>
            <div class="form-hint strong">密码只显示这一次，请现在填到阅读 App 里。忘了可以重置。</div>
          </dd>
          <dd v-else-if="status?.enabled">
            已开通 · {{ formatServerTime(status.created_at) }}
            <span v-if="status.last_used_at" class="muted">（最近使用 {{ formatServerTime(status.last_used_at) }}）</span>
          </dd>
          <dd v-else class="muted">未开通</dd>
        </dl>
      </section>

      <section v-if="status" class="section-card">
        <h2 class="section-title">{{ status.enabled ? '重置或关闭' : '开通' }}</h2>
        <p class="section-desc">
          {{ status.enabled
            ? '重置后旧密码立即失效，各设备上要填新密码；关闭后所有阅读 App 都无法再连接。'
            : '开通会生成一个专用密码，与登录密码不同。改登录密码不影响它。' }}
        </p>
        <label class="auth-field">
          <span>登录密码（确认是你本人）</span>
          <el-input v-model="loginPassword" type="password" show-password autocomplete="current-password" placeholder="请输入登录密码" />
        </label>
        <div v-if="errorMsg" class="auth-error">{{ errorMsg }}</div>
        <div class="section-actions">
          <el-button v-if="status.enabled" @click="onDisable">关闭</el-button>
          <el-button type="primary" :loading="issuing" :disabled="!loginPassword" @click="onIssue">
            {{ status.enabled ? '重置密码' : '开通' }}
          </el-button>
        </div>
      </section>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import { opdsApi, type OpdsStatus } from '@/api/opds'
import { formatServerTime } from '@/utils/time'

const feedUrl = `${location.origin}/opds`
const isHttp = location.protocol === 'http:'

const status = ref<OpdsStatus | null>(null)
const newPassword = ref('')
const loginPassword = ref('')
const issuing = ref(false)
const errorMsg = ref('')

async function load() {
  const resp = await opdsApi.status()
  status.value = resp.data.data ?? null
}

async function onIssue() {
  if (!status.value || issuing.value) return
  if (status.value.enabled) {
    try {
      await ElMessageBox.confirm('重置后旧密码立即失效，各设备上的阅读 App 要填新密码。', '重置 OPDS 密码', {
        type: 'warning', confirmButtonText: '重置', cancelButtonText: '取消',
      })
    } catch { return }
  }
  issuing.value = true
  errorMsg.value = ''
  try {
    const resp = await opdsApi.issue(loginPassword.value)
    newPassword.value = resp.data.data?.password ?? ''
    loginPassword.value = ''
    await load()
  } catch (err: unknown) {
    errorMsg.value = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '操作失败，请重试'
  } finally {
    issuing.value = false
  }
}

async function onDisable() {
  try {
    await ElMessageBox.confirm('关闭后所有阅读 App 都无法再连接书库。', '关闭 OPDS', {
      type: 'warning', confirmButtonText: '关闭', cancelButtonText: '取消',
    })
  } catch { return }
  await opdsApi.disable()
  newPassword.value = ''
  ElMessage.success('OPDS 已关闭')
  await load()
}

function copy(text: string, done: string) {
  // HTTP 下没有 navigator.clipboard，退回 execCommand
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => ElMessage.success(done)).catch(() => fallbackCopy(text, done))
  } else {
    fallbackCopy(text, done)
  }
}

function fallbackCopy(text: string, done: string) {
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  ElMessage.success(done)
}

onMounted(load)
</script>

<style scoped>
.opds-fields {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 10px 16px;
  margin: 16px 0 0;
  align-items: baseline;
}
.opds-fields dt { color: var(--text-2); font-size: 14px; }
.opds-fields dd { margin: 0; word-break: break-all; }
.opds-fields code { font-size: 14px; }
.opds-password { font-size: 16px; font-weight: 600; letter-spacing: 1px; }
.muted { color: var(--text-3); }
.form-hint { margin-top: 6px; font-size: 13px; color: var(--text-2); }
.form-hint.strong { color: var(--el-color-warning); }
.http-warning {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md, 8px);
  background: var(--el-color-warning-light-9);
  color: var(--el-color-warning-dark-2);
  font-size: 13px;
}
.auth-field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; max-width: 360px; }
.auth-field > span { font-size: 14px; color: var(--text-2); }
.auth-error { margin-top: 8px; color: var(--el-color-danger); font-size: 13px; }
.section-actions { margin-top: 16px; display: flex; gap: 8px; }

@media (max-width: 768px) {
  .opds-fields { grid-template-columns: 1fr; gap: 4px; }
  .opds-fields dd { margin-bottom: 8px; }
  .auth-field { max-width: none; }
}
</style>
