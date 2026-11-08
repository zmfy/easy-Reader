<template>
  <section class="section-card">
    <h2 class="section-title">HTTPS 证书</h2>
    <div class="hc-switch">
      <el-switch
        :model-value="!!state?.enabled"
        :loading="toggling"
        :disabled="!state"
        aria-label="启用 HTTPS"
        @change="toggle"
      />
      <span class="hc-switch-label">启用 HTTPS</span>
    </div>
    <p class="section-desc">需要在手机上安装到桌面（PWA）或从外网用 HTTPS 访问时再开启。使用你自己的证书，本程序不申请、不续签证书。</p>

    <template v-if="state?.enabled">
    <div class="hc-status">
      <div class="hc-row">
        <span class="hc-badge" :class="state.listening ? 'is-on' : 'is-off'">
          {{ state.listening ? 'HTTPS 已开启' : 'HTTPS 未开启' }}
        </span>
        <span v-if="state.listening" class="hc-meta">端口 {{ state.port }}（容器内端口，按 docker-compose 的映射访问）</span>
      </div>
      <p v-if="state.lastError" class="note note--warning hc-error">{{ state.lastError }}</p>
      <dl v-if="state.cert" class="hc-cert">
        <dt>域名</dt><dd>{{ state.cert.domains.join('、') }}</dd>
        <dt>颁发者</dt><dd>{{ state.cert.issuer }}</dd>
        <dt>有效期至</dt>
        <dd>
          {{ formatDate(state.cert.notAfter) }}
          <span class="hc-days" :class="{ 'is-bad': expiryBad }">{{ expiryText }}</span>
        </dd>
      </dl>
    </div>

    <div class="hc-upload">
      <div class="form-grid">
        <div class="form-field span-2">
          <label>证书（fullchain.pem，含证书链）</label>
          <el-input v-model="certText" type="textarea" :rows="4" placeholder="-----BEGIN CERTIFICATE-----" />
          <input class="hc-file" type="file" accept=".pem,.crt,.cer,.txt" aria-label="选择证书文件" @change="e => readFile(e, 'cert')" />
        </div>
        <div class="form-field span-2">
          <label>私钥（privkey.pem）</label>
          <el-input v-model="keyText" type="textarea" :rows="4" placeholder="-----BEGIN PRIVATE KEY-----" />
          <input class="hc-file" type="file" accept=".pem,.key,.txt" aria-label="选择私钥文件" @change="e => readFile(e, 'key')" />
        </div>
      </div>
      <div class="section-actions">
        <el-button type="primary" :loading="uploading" :disabled="!certText.trim() || !keyText.trim()" @click="upload">上传并启用</el-button>
        <el-button v-if="state?.cert" type="danger" plain @click="remove">删除证书</el-button>
      </div>
      <p class="form-hint">也可以把 fullchain.pem 与 privkey.pem 放进数据目录的 certs 文件夹，替换后自动生效</p>
    </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { settingsApi } from '@/api/settings'
import { useSystemNoticeStore } from '@/stores/system-notice'
import type { HttpsStatus } from '@/types'

const noticeStore = useSystemNoticeStore()
const state = ref<HttpsStatus | null>(null)
const toggling = ref(false)
const certText = ref('')
const keyText = ref('')
const uploading = ref(false)

const expiryBad = computed(() => !!state.value?.cert && (state.value.cert.expired || state.value.cert.notYetValid || state.value.cert.daysLeft <= 14))
const expiryText = computed(() => {
  const c = state.value?.cert
  if (!c) return ''
  if (c.expired) return '已过期'
  if (c.notYetValid) return '尚未生效'
  return `还有 ${c.daysLeft} 天到期`
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function errorText(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } }).response?.data?.message || fallback
}

async function load() {
  try {
    state.value = (await settingsApi.getHttps()).data.data ?? null
  } catch (err) {
    ElMessage.error(errorText(err, '读取 HTTPS 状态失败'))
  }
}

// 开关 / 上传 / 删除后，铃铛里的到期提醒随之更新
function refreshNotices() {
  noticeStore.load().catch(() => {})
}

async function toggle(v: string | number | boolean) {
  toggling.value = true
  try {
    state.value = (await settingsApi.setHttpsEnabled(!!v)).data.data ?? null
    refreshNotices()
  } catch (err) {
    ElMessage.error(errorText(err, '切换失败'))
  } finally {
    toggling.value = false
  }
}

function readFile(e: Event, which: 'cert' | 'key') {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  file.text().then(t => { if (which === 'cert') certText.value = t; else keyText.value = t })
}

async function upload() {
  uploading.value = true
  try {
    const next = (await settingsApi.uploadHttps(certText.value, keyText.value)).data.data!
    state.value = next
    certText.value = ''
    keyText.value = ''
    if (next.warnings?.length) next.warnings.forEach(w => ElMessage.warning(w))
    else ElMessage.success('证书已保存')
    refreshNotices()
  } catch (err) {
    ElMessage.error(errorText(err, '证书保存失败'))
  } finally {
    uploading.value = false
  }
}

async function remove() {
  try {
    await ElMessageBox.confirm('删除后 HTTPS 将关闭（HTTP 不受影响）。确定删除证书吗？', '删除证书', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' })
  } catch {
    return
  }
  try {
    state.value = (await settingsApi.deleteHttps()).data.data ?? null
    ElMessage.success('证书已删除')
    refreshNotices()
  } catch (err) {
    ElMessage.error(errorText(err, '删除失败'))
  }
}

onMounted(load)
</script>

<style scoped>
.hc-switch { display: flex; align-items: center; gap: 10px; margin: 12px 0 6px; }
.hc-switch-label { font-size: 14px; color: var(--text-0); }
.hc-status { margin-bottom: 14px; }
.hc-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.hc-badge { padding: 3px 10px; border-radius: 999px; font-size: 13px; }
.hc-badge.is-on { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.hc-badge.is-off { color: var(--text-2); background: var(--bg-2); }
.hc-meta { font-size: 13px; color: var(--text-2); }
.hc-error { margin: 10px 0 0; }
.hc-cert { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 12px 0 0; font-size: 14px; }
.hc-cert dt { color: var(--text-2); }
.hc-cert dd { margin: 0; color: var(--text-0); word-break: break-all; }
.hc-days { margin-left: 8px; font-size: 13px; color: var(--text-2); }
.hc-days.is-bad { color: var(--danger); }
.hc-file { margin-top: 6px; font-size: 13px; color: var(--text-2); }
/* 与设置页其他卡片的表单标签一致（Settings.vue 的样式是 scoped，作用不到本组件） */
.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-field label { font-size: 13px; font-weight: 500; color: var(--text-1); }
</style>
