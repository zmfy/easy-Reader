<template>
  <DefaultLayout>
    <div class="settings-page">
      <div class="page-header">
        <h1 class="page-title">系统设置</h1>
      </div>

      <div class="settings-layout">
        <nav class="settings-nav">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="nav-item"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            <el-icon><component :is="tab.icon" /></el-icon>
            {{ tab.label }}
          </button>
        </nav>

        <div class="settings-content">
          <!-- System Settings -->
          <div v-if="activeTab === 'system'" class="setting-section">
            <h2 class="section-title">系统设置</h2>
            <div class="form-grid">
              <div class="form-field">
                <label>站点名称</label>
                <el-input v-model="sysForm.site_name" placeholder="夜航书房" />
              </div>
              <div class="form-field">
                <label>书库目录</label>
                <el-input v-model="sysForm.books_dir" placeholder="/app/books" />
              </div>
            </div>

            <!-- 主题选择 -->
            <div class="form-field theme-field">
              <label>网站主题</label>
              <div class="theme-cards">
                <div
                  v-for="t in siteThemes"
                  :key="t.key"
                  class="theme-card"
                  :class="{ active: sysForm.site_theme === t.key }"
                  @click="sysForm.site_theme = t.key"
                >
                  <div class="theme-preview" :style="{ background: t.bg }">
                    <div class="theme-preview-bar" :style="{ background: t.panel }">
                      <div class="theme-preview-dot" :style="{ background: t.accent }" />
                      <div class="theme-preview-dot" :style="{ background: t.accent, opacity: 0.5 }" />
                    </div>
                    <div class="theme-preview-lines">
                      <div class="theme-preview-line" :style="{ background: t.text, width: '70%' }" />
                      <div class="theme-preview-line" :style="{ background: t.text, width: '90%', opacity: 0.6 }" />
                      <div class="theme-preview-line" :style="{ background: t.text, width: '55%', opacity: 0.4 }" />
                    </div>
                    <div class="theme-preview-accent" :style="{ background: t.accent }" />
                  </div>
                  <div class="theme-card-info">
                    <span class="theme-name">{{ t.label }}</span>
                    <span class="theme-desc">{{ t.desc }}</span>
                  </div>
                  <div v-if="sysForm.site_theme === t.key" class="theme-check">✓</div>
                </div>
              </div>
            </div>

            <el-button type="primary" :loading="saving" @click="saveSettings('system')">保存系统设置</el-button>
          </div>

          <!-- SMTP Settings -->
          <div v-if="activeTab === 'smtp'" class="setting-section">
            <h2 class="section-title">邮件设置</h2>
            <div class="form-grid">
              <div class="form-field">
                <label>SMTP 服务器地址</label>
                <el-input v-model="smtpForm.smtp_host" placeholder="smtp.example.com" />
              </div>
              <div class="form-field">
                <label>端口</label>
                <el-input v-model="smtpForm.smtp_port" placeholder="587" />
              </div>
              <div class="form-field">
                <label>用户名</label>
                <el-input v-model="smtpForm.smtp_user" placeholder="user@example.com" />
              </div>
              <div class="form-field">
                <label>密码</label>
                <el-input
                  v-model="smtpForm.smtp_pass"
                  type="password"
                  show-password
                  :placeholder="smtpPassSet ? '已设置（输入新密码以修改）' : '请输入密码'"
                />
              </div>
              <div class="form-field">
                <label>发件人地址</label>
                <el-input v-model="smtpForm.smtp_from" placeholder="noreply@example.com" />
              </div>
            </div>
            <el-button type="primary" :loading="saving" @click="saveSettings('smtp')">保存邮件设置</el-button>
          </div>

          <!-- AI Settings -->
          <div v-if="activeTab === 'ai'" class="setting-section">
            <h2 class="section-title">AI 插件设置</h2>
            <div class="form-field" style="margin-bottom: 20px">
              <label>选择 AI 插件</label>
              <el-select v-model="selectedAiPlugin" style="width: 100%">
                <el-option
                  v-for="plugin in aiPlugins"
                  :key="plugin.name"
                  :label="plugin.label"
                  :value="plugin.name"
                />
              </el-select>
            </div>
            <div v-if="currentAiPlugin" class="form-grid">
              <div
                v-for="field in currentAiPlugin.fields"
                :key="field"
                class="form-field"
              >
                <label>{{ fieldLabels[field] || field }}</label>
                <el-input
                  v-model="aiForm[field]"
                  :type="field === 'apiKey' ? 'password' : 'text'"
                  :placeholder="getFieldPlaceholder(field)"
                  :show-password="field === 'apiKey'"
                />
              </div>
            </div>
            <el-button type="primary" :loading="saving" @click="saveSettings('ai')">保存 AI 设置</el-button>
          </div>

          <!-- User Management -->
          <div v-if="activeTab === 'users'" class="setting-section">
            <div class="section-header">
              <h2 class="section-title">用户管理</h2>
              <el-button type="primary" size="small" @click="openInviteDialog" :loading="creatingInvite">
                生成邀请码
              </el-button>
            </div>
            <el-table :data="users" class="users-table" stripe>
              <el-table-column prop="username" label="用户名" />
              <el-table-column prop="role" label="角色">
                <template #default="{ row }">
                  <el-tag :type="row.role === 'admin' ? 'danger' : 'info'">
                    {{ row.role === 'admin' ? '管理员' : '普通用户' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="注册时间">
                <template #default="{ row }">
                  {{ new Date(row.created_at).toLocaleDateString('zh-CN') }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="200">
                <template #default="{ row }">
                  <el-button
                    v-if="row.id !== authStore.user?.id"
                    size="small"
                    @click="toggleRole(row)"
                  >
                    {{ row.role === 'admin' ? '降为普通' : '升为管理员' }}
                  </el-button>
                  <el-button size="small" type="warning" @click="openPwdDialog(row)">
                    修改密码
                  </el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- Plugin Info -->
          <div v-if="activeTab === 'plugins'" class="setting-section">
            <h2 class="section-title">插件管理</h2>
            <div class="plugins-grid">
              <div v-for="plugin in readerPlugins" :key="plugin.format" class="plugin-card">
                <div class="plugin-icon">{{ formatIcon(plugin.format) }}</div>
                <div class="plugin-info">
                  <div class="plugin-name">{{ plugin.label }}</div>
                  <div class="plugin-desc">{{ plugin.description }}</div>
                </div>
                <el-tag type="success">已加载</el-tag>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Invite Dialog -->
    <el-dialog
      v-model="inviteDialogVisible"
      title="邀请新用户"
      width="480px"
      :close-on-click-modal="false"
    >
      <div v-if="inviteCode" class="invite-dialog-body">
        <div class="invite-code-block">
          <div class="invite-code-label">邀请码（{{ inviteExpiry }} 过期）</div>
          <div class="invite-code-value">{{ inviteCode }}</div>
        </div>

        <!-- Copy invite link -->
        <div class="invite-action">
          <div class="action-title">拷贝邀请链接</div>
          <div class="invite-url-row">
            <el-input :value="inviteUrl" readonly size="small" class="invite-url-input" />
            <el-button type="primary" size="small" @click="copyInviteLink">
              <el-icon><CopyDocument /></el-icon>
              复制
            </el-button>
          </div>
        </div>

        <!-- Send email -->
        <div class="invite-action">
          <div class="action-title">
            发送邀请邮件
            <el-tag v-if="!smtpConfigured" type="warning" size="small" style="margin-left:8px;">SMTP 未配置</el-tag>
          </div>
          <div v-if="!smtpConfigured" class="smtp-tip">
            请先在
            <el-link type="primary" @click="activeTab = 'smtp'; inviteDialogVisible = false">邮件设置</el-link>
            中配置 SMTP 服务器。
          </div>
          <div v-else class="email-row">
            <el-input
              v-model="inviteEmail"
              placeholder="收件人邮箱地址"
              size="small"
              class="email-input"
              :disabled="sendingEmail"
            />
            <el-button
              type="primary"
              size="small"
              :loading="sendingEmail"
              @click="sendInviteEmail"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="inviteDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- Change Password Dialog -->
    <el-dialog
      v-model="pwdDialogVisible"
      :title="`修改密码 — ${changingPwdUser?.username}`"
      width="440px"
      :close-on-click-modal="false"
      @closed="resetPwdForm"
    >
      <div class="pwd-dialog-body">
        <div class="form-field">
          <label>新密码</label>
          <el-input
            v-model="pwdForm.newPassword"
            type="password"
            show-password
            placeholder="请输入新密码"
            autocomplete="new-password"
          />
        </div>
        <div class="form-field">
          <label>确认新密码</label>
          <el-input
            v-model="pwdForm.confirmPassword"
            type="password"
            show-password
            placeholder="再次输入新密码"
            autocomplete="new-password"
            @keyup.enter="submitChangePassword"
          />
        </div>
        <div class="pwd-rules">
          <div class="pwd-rule" :class="pwdRules.minLen ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.minLen ? '✓' : '✗' }}</span> 至少 8 位
          </div>
          <div class="pwd-rule" :class="pwdRules.hasUpper ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.hasUpper ? '✓' : '✗' }}</span> 至少 1 个大写字母
          </div>
          <div class="pwd-rule" :class="pwdRules.hasLower ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.hasLower ? '✓' : '✗' }}</span> 至少 1 个小写字母
          </div>
          <div class="pwd-rule" :class="pwdRules.hasNumber ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.hasNumber ? '✓' : '✗' }}</span> 至少 1 个数字
          </div>
          <div class="pwd-rule" :class="pwdRules.hasSpecial ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.hasSpecial ? '✓' : '✗' }}</span> 至少 1 个特殊字符（如 !@#$%^&*）
          </div>
          <div class="pwd-rule" :class="pwdRules.matched ? 'pass' : 'fail'">
            <span class="rule-icon">{{ pwdRules.matched ? '✓' : '✗' }}</span> 两次密码一致
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="pwdDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="changingPwd"
          :disabled="!pwdValid"
          @click="submitChangePassword"
        >
          确认修改
        </el-button>
      </template>
    </el-dialog>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { Setting, User, MagicStick, Cpu, Message, CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { settingsApi } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const activeTab = ref('system')
const saving = ref(false)
const creatingInvite = ref(false)
const sendingEmail = ref(false)
const inviteDialogVisible = ref(false)

// ── Password Dialog ──
const pwdDialogVisible = ref(false)
const changingPwd = ref(false)
const changingPwdUser = ref<{ id: string; username: string } | null>(null)
const pwdForm = reactive({ newPassword: '', confirmPassword: '' })

const pwdRules = computed(() => {
  const p = pwdForm.newPassword
  return {
    minLen: p.length >= 8,
    hasUpper: /[A-Z]/.test(p),
    hasLower: /[a-z]/.test(p),
    hasNumber: /[0-9]/.test(p),
    hasSpecial: /[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>/?`~]/.test(p),
    matched: p.length > 0 && p === pwdForm.confirmPassword,
  }
})

const pwdValid = computed(() => Object.values(pwdRules.value).every(Boolean))

function openPwdDialog(user: { id: string; username: string }) {
  changingPwdUser.value = user
  pwdDialogVisible.value = true
}

function resetPwdForm() {
  pwdForm.newPassword = ''
  pwdForm.confirmPassword = ''
  changingPwdUser.value = null
}

async function submitChangePassword() {
  if (!pwdValid.value || !changingPwdUser.value) return
  changingPwd.value = true
  try {
    await settingsApi.changeUserPassword(changingPwdUser.value.id, pwdForm.newPassword)
    ElMessage.success('密码已修改')
    pwdDialogVisible.value = false
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '修改失败'
    ElMessage.error(msg)
  } finally {
    changingPwd.value = false
  }
}
const inviteCode = ref('')
const inviteExpiry = ref('')
const inviteEmail = ref('')
const smtpConfigured = ref(false)
const smtpPassSet = ref(false)
const users = ref<Array<{ id: string; username: string; role: string; created_at: string }>>([])
const aiPlugins = ref<Array<{ name: string; label: string; fields: string[]; placeholders?: Record<string, string> }>>([])
const readerPlugins = ref<Array<{ format: string; label: string; description: string }>>([])
const selectedAiPlugin = ref('')
const aiForm = reactive<Record<string, string>>({})
const settingsData = ref<Record<string, string>>({})

const sysForm = reactive({
  site_name: '',
  books_dir: '/app/books',
  site_theme: 'dark',
})

const siteThemes = [
  {
    key: 'dark',
    label: '暗夜',
    desc: '深邃宇宙蓝',
    bg: '#0b1020',
    panel: '#121a2b',
    accent: '#7c5cff',
    text: '#c9d3ea',
  },
  {
    key: 'warm',
    label: '烛光',
    desc: '温暖琥珀棕',
    bg: '#16100a',
    panel: '#221810',
    accent: '#e8923a',
    text: '#d4b890',
  },
  {
    key: 'cool',
    label: '冷月',
    desc: '清冷冰蓝银',
    bg: '#060c14',
    panel: '#0c1622',
    accent: '#38c8e8',
    text: '#90b4cc',
  },
  {
    key: 'sky',
    label: '晴空',
    desc: '清爽白蓝',
    bg: '#f0f4ff',
    panel: '#ffffff',
    accent: '#4a6cf7',
    text: '#3a4a6a',
  },
  {
    key: 'paper',
    label: '素纸',
    desc: '暖白米黄',
    bg: '#faf6f0',
    panel: '#ffffff',
    accent: '#b85c38',
    text: '#4a3828',
  },
]

const smtpForm = reactive({
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
})

const tabs = [
  { key: 'system', label: '系统', icon: Setting },
  { key: 'smtp', label: '邮件', icon: Message },
  { key: 'ai', label: 'AI 设置', icon: MagicStick },
  { key: 'users', label: '用户管理', icon: User },
  { key: 'plugins', label: '插件', icon: Cpu },
]

const fieldLabels: Record<string, string> = {
  apiKey: 'API Key',
  model: '模型',
  baseUrl: '接口地址',
}

const fieldPlaceholders: Record<string, string> = {
  apiKey: 'sk-...',
  model: '',
  baseUrl: '',
}

function getFieldPlaceholder(field: string): string {
  return currentAiPlugin.value?.placeholders?.[field] || fieldPlaceholders[field] || ''
}

const currentAiPlugin = computed(() =>
  aiPlugins.value.find(p => p.name === selectedAiPlugin.value)
)

const inviteUrl = computed(() => {
  if (!inviteCode.value) return ''
  return `${window.location.origin}/register?code=${inviteCode.value}`
})

function formatIcon(format: string) {
  const icons: Record<string, string> = { txt: '📄', epub: '📕', pdf: '📰' }
  return icons[format] || '📁'
}

function populateAiForm(plugin: string) {
  Object.keys(aiForm).forEach(k => delete aiForm[k])
  const prefix = `ai_${plugin}_`
  for (const [key, value] of Object.entries(settingsData.value)) {
    if (key.startsWith(prefix)) {
      aiForm[key.slice(prefix.length)] = value
    }
  }
}

watch(selectedAiPlugin, (plugin) => {
  if (plugin && Object.keys(settingsData.value).length) populateAiForm(plugin)
})

async function loadSettings() {
  const resp = await settingsApi.get()
  const data = resp.data.data || {}
  settingsData.value = data

  sysForm.site_name = data['site_name'] || ''
  sysForm.books_dir = data['books_dir'] || '/app/books'
  sysForm.site_theme = data['site_theme'] || 'dark'

  smtpForm.smtp_host = data['smtp_host'] || ''
  smtpForm.smtp_port = data['smtp_port'] || '587'
  smtpForm.smtp_user = data['smtp_user'] || ''
  smtpForm.smtp_from = data['smtp_from'] || ''
  smtpPassSet.value = data['smtp_pass'] === '****'
  smtpForm.smtp_pass = ''

  smtpConfigured.value = !!data['smtp_host']

  const plugin = data['ai_plugin']
  if (plugin) {
    selectedAiPlugin.value = plugin
    populateAiForm(plugin)
  }
}

async function loadPlugins() {
  const [aiResp, readerResp] = await Promise.all([
    settingsApi.getAiPlugins(),
    settingsApi.getReaderPlugins(),
  ])
  aiPlugins.value = aiResp.data.data || []
  readerPlugins.value = readerResp.data.data || []
}

async function loadUsers() {
  const resp = await settingsApi.getUsers()
  users.value = resp.data.data || []
}

async function saveSettings(tab: string) {
  saving.value = true
  try {
    const payload: Record<string, string> = {}
    if (tab === 'system') {
      Object.assign(payload, sysForm)
    } else if (tab === 'smtp') {
      payload.smtp_host = smtpForm.smtp_host
      payload.smtp_port = smtpForm.smtp_port
      payload.smtp_user = smtpForm.smtp_user
      payload.smtp_from = smtpForm.smtp_from
      if (smtpForm.smtp_pass) {
        payload.smtp_pass = smtpForm.smtp_pass
      }
    } else if (tab === 'ai' && currentAiPlugin.value) {
      payload['ai_plugin'] = selectedAiPlugin.value
      for (const field of currentAiPlugin.value.fields) {
        if (aiForm[field]) {
          payload[`ai_${selectedAiPlugin.value}_${field}`] = aiForm[field]
        }
      }
    }
    await settingsApi.update(payload)
    if (tab === 'smtp') {
      smtpConfigured.value = !!smtpForm.smtp_host
      smtpPassSet.value = smtpPassSet.value || !!smtpForm.smtp_pass
      smtpForm.smtp_pass = ''
    }
    if (tab === 'system') {
      if (sysForm.site_name) document.title = sysForm.site_name
      document.documentElement.dataset.theme = sysForm.site_theme
    }
    ElMessage.success('设置已保存')
  } finally {
    saving.value = false
  }
}

async function openInviteDialog() {
  creatingInvite.value = true
  try {
    const resp = await settingsApi.createInvite()
    inviteCode.value = resp.data.data?.code || ''
    inviteExpiry.value = new Date(resp.data.data?.expiresAt || '').toLocaleDateString('zh-CN')
    inviteEmail.value = ''
    inviteDialogVisible.value = true
  } finally {
    creatingInvite.value = false
  }
}

function copyInviteLink() {
  navigator.clipboard.writeText(inviteUrl.value).then(() => {
    ElMessage.success('邀请链接已复制')
  })
}

async function sendInviteEmail() {
  if (!inviteEmail.value) {
    ElMessage.warning('请输入收件人邮箱')
    return
  }
  sendingEmail.value = true
  try {
    await settingsApi.sendInviteEmail(inviteEmail.value, inviteCode.value, inviteUrl.value)
    ElMessage.success('邀请邮件已发送')
    inviteEmail.value = ''
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '发送失败'
    ElMessage.error(msg)
  } finally {
    sendingEmail.value = false
  }
}

async function toggleRole(user: { id: string; role: string }) {
  const newRole = user.role === 'admin' ? 'user' : 'admin'
  await settingsApi.updateUserRole(user.id, newRole)
  user.role = newRole
  ElMessage.success('角色已更新')
}

onMounted(async () => {
  await Promise.all([loadSettings(), loadPlugins(), loadUsers()])
})
</script>

<style scoped>
.settings-page {
  padding: 32px;
  min-height: 100%;
}

.page-header {
  margin-bottom: 28px;
}

.page-title {
  font-size: 26px;
  font-weight: 600;
  color: var(--text-0);
}

.settings-layout {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 24px;
  align-items: start;
}

.settings-nav {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.1);
  border-radius: var(--radius-lg);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 20px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 14px;
  font-family: var(--font-sans);
  text-align: left;
  transition: all 0.15s ease;
}

.nav-item:hover {
  background: rgba(124, 92, 255, 0.08);
  color: var(--text-1);
}

.nav-item.active {
  background: rgba(124, 92, 255, 0.18);
  color: var(--accent);
  font-weight: 500;
}

.settings-content {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.1);
  border-radius: var(--radius-lg);
  padding: 28px;
}

.setting-section {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-0);
  margin-bottom: 20px;
}

.section-header .section-title {
  margin-bottom: 0;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
}

.users-table {
  background: transparent !important;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(124, 92, 255, 0.05);
}

.plugins-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.plugin-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  background: var(--bg-2);
  border-radius: var(--radius-md);
}

.plugin-icon {
  font-size: 24px;
}

.plugin-info {
  flex: 1;
}

.plugin-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-0);
}

.plugin-desc {
  font-size: 12px;
  color: var(--text-2);
  margin-top: 2px;
}

/* Invite Dialog */
.invite-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.invite-code-block {
  background: rgba(0, 212, 184, 0.08);
  border: 1px solid rgba(0, 212, 184, 0.2);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  text-align: center;
}

.invite-code-label {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 6px;
}

.invite-code-value {
  font-size: 26px;
  font-weight: 700;
  color: var(--accent-2);
  letter-spacing: 4px;
}

.invite-action {
  border: 1px solid rgba(124, 92, 255, 0.12);
  border-radius: var(--radius-md);
  padding: 14px 16px;
}

.action-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
}

.invite-url-row,
.email-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.invite-url-input,
.email-input {
  flex: 1;
}

.smtp-tip {
  font-size: 13px;
  color: var(--text-2);
}

/* ── Site theme selector ── */
.theme-field {
  margin-bottom: 20px;
}

.theme-cards {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.theme-card {
  position: relative;
  width: 130px;
  border-radius: var(--radius-md);
  border: 2px solid rgba(128, 128, 128, 0.2);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.15s ease;
}
.theme-card:hover {
  transform: translateY(-2px);
  border-color: rgba(128, 128, 128, 0.5);
}
.theme-card.active {
  border-color: var(--accent);
}

.theme-preview {
  height: 80px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.theme-preview-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 5px;
  border-radius: 4px;
}

.theme-preview-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.theme-preview-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 4px;
}

.theme-preview-line {
  height: 3px;
  border-radius: 2px;
}

.theme-preview-accent {
  position: absolute;
  bottom: 6px;
  right: 8px;
  width: 20px;
  height: 6px;
  border-radius: 3px;
}

.theme-card-info {
  display: flex;
  flex-direction: column;
  padding: 6px 10px 8px;
  background: var(--bg-2);
  gap: 2px;
}

.theme-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-0);
}

.theme-desc {
  font-size: 11px;
  color: var(--text-2);
}

.theme-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: white;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}

/* ── Password Dialog ── */
.pwd-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.pwd-rules {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--bg-2);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.pwd-rule {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  transition: color 0.2s ease;
}

.pwd-rule.pass {
  color: #22c55e;
}

.pwd-rule.fail {
  color: var(--text-2);
}

.rule-icon {
  font-size: 12px;
  font-weight: 700;
  width: 14px;
  flex-shrink: 0;
}
</style>
