<template>
  <DefaultLayout>
    <div class="settings-page">
      <div class="page-header">
        <h1 class="page-title">系统设置</h1>
      </div>

      <!-- 手机端顶部横向标签栏 -->
      <div class="settings-tabs-mobile">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="tab-chip"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <el-icon><component :is="tab.icon" /></el-icon>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <div class="settings-layout">
        <!-- 桌面端左侧竖向导航 -->
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
                <label>站点副标题</label>
                <el-input v-model="sysForm.site_subtitle" placeholder="Night Reader · NAS Novel Platform" />
              </div>
              <div class="form-field">
                <label>站点公开地址</label>
                <el-input v-model="sysForm.site_url" placeholder="https://your-domain.com:36485" />
                <div class="field-hint">用于生成邀请链接，留空则自动使用当前访问地址</div>
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

          <!-- SMTP Settings (暂时隐藏) -->
          <!-- <div v-if="activeTab === 'smtp'" class="setting-section"> ... </div> -->

          <!-- Changelog / Feedback -->
          <div v-if="activeTab === 'feedback'" class="setting-section">
            <h2 class="section-title">更新说明</h2>
            <p class="section-desc">以下为最近的版本更新内容。</p>
            <div class="changelog-list">
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-txt">TXT</span>
                  <span class="changelog-text">修复 UTF-16 编码的 TXT 小说打开后乱码的问题，并将编码自动识别的采样范围扩大至 64KB，提升 GBK/中文文件的识别准确度</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-epub">EPUB</span>
                  <span class="changelog-text">漫画/图册 EPUB 自动切换全页流模式，不再跳过无 TOC 标题的页面（如柯南全 1457 页均可阅读）</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-epub">EPUB</span>
                  <span class="changelog-text">支持 EPUB 内嵌图片显示，图片通过独立 API 端点从 EPUB 包中提取并返回浏览器</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-epub">EPUB</span>
                  <span class="changelog-text">修复 EPUB 章节内链接点击后跳转错误（内部 href 现映射至正确章节索引）</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-epub">EPUB</span>
                  <span class="changelog-text">修复 EPUB 章节内容无法加载的问题（TOC id 与 flow id 不匹配导致 File not found）</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-reader">阅读</span>
                  <span class="changelog-text">瀑布流模式：章节内容较短时自动预加载后续章节，确保从首章即可流畅下翻</span>
                </div>
                <span class="changelog-date">2026-06-04</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-ui">界面</span>
                  <span class="changelog-text">优化书库封面图片加载与样式展示</span>
                </div>
                <span class="changelog-date">2026-05-06</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-lib">书库</span>
                  <span class="changelog-text">扫描导入时自动清理已删除文件的数据库记录</span>
                </div>
                <span class="changelog-date">2026-05-06</span>
              </div>
              <div class="changelog-item">
                <div class="changelog-main">
                  <span class="changelog-tag tag-auth">认证</span>
                  <span class="changelog-text">重构登录 Token 处理，优化反馈功能</span>
                </div>
                <span class="changelog-date">2026-04-24</span>
              </div>
            </div>

            <h3 class="roadmap-title">开发计划</h3>
            <div class="changelog-list">
              <div class="changelog-item changelog-item--plan">
                <div class="changelog-main">
                  <span class="changelog-tag tag-plan">计划</span>
                  <span class="changelog-text">封面抓取改为用户可选，手动触发</span>
                </div>
              </div>
              <div class="changelog-item changelog-item--plan">
                <div class="changelog-main">
                  <span class="changelog-tag tag-plan">计划</span>
                  <span class="changelog-text">书库扫描时对重复书籍进行检测与处理</span>
                </div>
              </div>
              <div class="changelog-item changelog-item--plan">
                <div class="changelog-main">
                  <span class="changelog-tag tag-plan">计划</span>
                  <span class="changelog-text">修复瀑布流模式下书签定位不准确的问题</span>
                </div>
              </div>
            </div>
            <div style="margin-top: 24px;">
              <el-button type="primary" @click="openFeedback">
                意见反馈
              </el-button>
            </div>
          </div>

          <!-- AI Settings -->
          <div v-if="activeTab === 'ai'" class="setting-section">
            <h2 class="section-title">AI 插件设置</h2>
            <div class="ai-tips">
              <div class="ai-tip-title">已测试通过的配置</div>
              <div class="ai-tip-item">
                <span class="ai-tip-name">DeepSeek</span>
                <span class="ai-tip-desc">模型：<code>deepseek-chat</code>，接口地址：<code>https://api.deepseek.com/v1</code></span>
              </div>
              <div class="ai-tip-item">
                <span class="ai-tip-name">MiniMax</span>
                <span class="ai-tip-desc">模型：<code>MiniMax-M2</code></span>
              </div>
            </div>
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
                  :placeholder="field === 'apiKey' ? (aiApiKeySet ? '已设置（输入新 Key 以修改）' : getFieldPlaceholder(field)) : getFieldPlaceholder(field)"
                  :show-password="field === 'apiKey'"
                />
              </div>
            </div>
            <div class="form-field" style="margin-top: 16px">
              <label>书籍简介长度（字）</label>
              <el-select v-model="aiSummaryLength" style="width: 100%">
                <el-option label="50 字（极简）" :value="50" />
                <el-option label="100 字（默认）" :value="100" />
                <el-option label="200 字" :value="200" />
                <el-option label="300 字" :value="300" />
                <el-option label="500 字" :value="500" />
              </el-select>
              <div class="field-hint">影响 AI 填充 + 批量填充时生成的简介字数</div>
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
              <el-table-column label="操作" width="260">
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
                  <el-popconfirm
                    v-if="row.id !== authStore.user?.id"
                    title="确定删除该用户？此操作不可恢复。"
                    confirm-button-text="删除"
                    cancel-button-text="取消"
                    confirm-button-type="danger"
                    @confirm="deleteUser(row.id)"
                  >
                    <template #reference>
                      <el-button size="small" type="danger" plain>删除</el-button>
                    </template>
                  </el-popconfirm>
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
                <template v-if="plugin.format === 'pdf'">
                  <div class="plugin-switch">
                    <span class="plugin-switch-label">{{ plugin.usePlugin ? '插件解析' : '浏览器原生' }}</span>
                    <el-switch
                      :model-value="plugin.usePlugin"
                      @change="(val: boolean) => togglePdfPlugin(val)"
                    />
                  </div>
                </template>
                <el-tag v-else type="success">已加载</el-tag>
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
const readerPlugins = ref<Array<{ format: string; label: string; description: string; usePlugin?: boolean }>>([])
const selectedAiPlugin = ref('')
const aiSummaryLength = ref<number>(100)
const aiForm = reactive<Record<string, string>>({})
const settingsData = ref<Record<string, string>>({})

const sysForm = reactive({
  site_name: '',
  site_subtitle: '',
  site_url: '',
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
  // { key: 'smtp', label: '邮件', icon: Message },  // 暂时隐藏邮件设置
  { key: 'ai', label: 'AI 设置', icon: MagicStick },
  { key: 'users', label: '用户管理', icon: User },
  { key: 'plugins', label: '插件', icon: Cpu },
  { key: 'feedback', label: '更新说明', icon: Message },
]


function openFeedback() {
  window.open('https://easyreader.ucool.uk/bbs', '_blank')
}

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

const aiApiKeySet = computed(() => {
  if (!selectedAiPlugin.value) return false
  return !!settingsData.value[`ai_${selectedAiPlugin.value}_apiKey`]
})

const inviteUrl = computed(() => {
  if (!inviteCode.value) return ''
  const base = sysForm.site_url?.replace(/\/$/, '') || window.location.origin
  return `${base}/register?code=${inviteCode.value}`
})

function formatIcon(format: string) {
  const icons: Record<string, string> = { txt: '📄', epub: '📕', pdf: '📰', umd: '📚' }
  return icons[format] || '📁'
}

async function togglePdfPlugin(val: boolean) {
  await settingsApi.update({ pdf_use_plugin: val ? 'true' : 'false' })
  const plugin = readerPlugins.value.find(p => p.format === 'pdf')
  if (plugin) plugin.usePlugin = val
  ElMessage.success(val ? 'PDF 已切换为插件解析模式' : 'PDF 已切换为浏览器原生模式')
}

function populateAiForm(plugin: string) {
  Object.keys(aiForm).forEach(k => delete aiForm[k])
  const prefix = `ai_${plugin}_`
  for (const [key, value] of Object.entries(settingsData.value)) {
    if (key.startsWith(prefix)) {
      const field = key.slice(prefix.length)
      // Don't populate apiKey with masked value — user must re-enter to change it
      if (field === 'apiKey') continue
      aiForm[field] = value
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
  sysForm.site_subtitle = data['site_subtitle'] || ''
  sysForm.site_url = data['site_url'] || ''
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
  const summaryLenStored = parseInt(data['ai_summary_length'] ?? '')
  if (Number.isFinite(summaryLenStored) && summaryLenStored >= 30 && summaryLenStored <= 1000) {
    aiSummaryLength.value = summaryLenStored
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
      payload['ai_summary_length'] = String(aiSummaryLength.value)
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
  const text = inviteUrl.value
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => {
      ElMessage.success('邀请链接已复制')
    }).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text: string) {
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  ElMessage.success('邀请链接已复制')
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

async function deleteUser(id: string) {
  try {
    await settingsApi.deleteUser(id)
    users.value = users.value.filter(u => u.id !== id)
    ElMessage.success('用户已删除')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message || '删除失败'
    ElMessage.error(msg)
  }
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

.section-desc {
  font-size: 14px;
  color: var(--text-2);
  margin-top: -12px;
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

.field-hint {
  font-size: 12px;
  color: var(--text-3, var(--text-2));
  opacity: 0.7;
  margin-top: -2px;
}

.users-table {
  background: transparent !important;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(124, 92, 255, 0.05);
}

.ai-tips {
  background: rgba(0, 212, 184, 0.06);
  border: 1px solid rgba(0, 212, 184, 0.18);
  border-radius: var(--radius-md);
  padding: 14px 18px;
  margin-bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ai-tip-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-2);
  margin-bottom: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ai-tip-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 13px;
}

.ai-tip-name {
  color: var(--text-1);
  font-weight: 600;
  min-width: 64px;
  flex-shrink: 0;
}

.ai-tip-desc {
  color: var(--text-2);
}

.ai-tip-desc code {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 12px;
  background: rgba(124, 92, 255, 0.12);
  color: var(--accent);
  padding: 1px 5px;
  border-radius: 3px;
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

.plugin-switch {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.plugin-switch-label {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
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

/* ── 手机端横向标签栏 ── */
.settings-tabs-mobile {
  display: none;
}

@media (max-width: 768px) {
  /* 顶部横向标签栏：仅手机显示 */
  .settings-tabs-mobile {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 12px 16px;
    background: var(--bg-0);
    border-bottom: 1px solid rgba(124, 92, 255, 0.1);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .settings-tabs-mobile::-webkit-scrollbar { display: none; }

  .tab-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 7px 14px;
    border: 1px solid rgba(124, 92, 255, 0.18);
    border-radius: 20px;
    background: transparent;
    color: var(--text-2);
    font-size: 13px;
    font-family: var(--font-sans);
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.18s ease;
    flex-shrink: 0;
  }
  .tab-chip .el-icon {
    font-size: 14px;
  }
  .tab-chip:hover {
    border-color: var(--accent);
    color: var(--text-1);
  }
  .tab-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 500;
    box-shadow: 0 2px 10px rgba(124, 92, 255, 0.35);
  }

  /* 桌面左侧导航：手机隐藏 */
  .settings-nav {
    display: none;
  }

  /* 内容区改为单列 */
  .settings-layout {
    display: block;
    gap: 0;
  }

  .settings-content {
    border-radius: var(--radius-md);
    padding: 20px 16px;
  }

  .settings-page {
    padding: 16px;
  }

  /* 主题卡片在手机上更紧凑 */
  .theme-cards {
    gap: 10px;
  }
  .theme-card {
    width: 100px;
  }

  /* 表单网格单列 */
  .form-grid {
    grid-template-columns: 1fr;
  }
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

/* ── Changelog ── */
.changelog-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 600px;
}

.changelog-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-2);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--text-1);
}

.changelog-item--plan {
  opacity: 0.75;
  border: 1px dashed var(--border-color);
  background: transparent;
}

.changelog-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
}

.changelog-date {
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  flex-shrink: 0;
}

.changelog-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
}

.tag-ui     { background: #3b1f6b; color: #c4b5fd; }
.tag-lib    { background: #1a3a2a; color: #6ee7b7; }
.tag-auth   { background: #1e2e50; color: #93c5fd; }
.tag-reader { background: #2d2010; color: #fcd34d; }
.tag-epub   { background: #1a2e3b; color: #67e8f9; }
.tag-txt    { background: #3a2410; color: #fdba74; }
.tag-ai     { background: #2d1020; color: #f9a8d4; }
.tag-infra  { background: #1f2937; color: #9ca3af; }
.tag-plan   { background: #1c1c2e; color: #a5b4fc; border: 1px solid #3730a3; }

.changelog-text {
  line-height: 1.6;
}

.roadmap-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-2);
  margin: 20px 0 10px;
  max-width: 600px;
}
</style>
