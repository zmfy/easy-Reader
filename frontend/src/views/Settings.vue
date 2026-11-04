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
                <el-input v-model="sysForm.site_name" placeholder="留空则使用默认：简单书房" />
              </div>
              <div class="form-field">
                <label>站点副标题</label>
                <el-input v-model="sysForm.site_subtitle" placeholder="留空则使用默认：Easy Reader · NAS Novel Platform" />
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
            <p class="section-desc">最近 {{ recentChangelog.length }} 次更新，点击标题查看本次调整内容。</p>
            <div class="changelog-list">
              <div
                v-for="release in recentChangelog"
                :key="release.date + release.title"
                class="changelog-release"
                :class="{ 'is-open': openedReleases.has(release.date + release.title) }"
              >
                <button
                  type="button"
                  class="changelog-release-header"
                  :aria-expanded="openedReleases.has(release.date + release.title)"
                  @click="toggleRelease(release.date + release.title)"
                >
                  <span class="changelog-release-title">
                    <span class="changelog-date">{{ release.date }}</span>：{{ release.title }}
                  </span>
                  <span class="changelog-release-meta">
                    <span class="changelog-count">{{ release.items.length }} 项</span>
                    <span class="changelog-arrow">▸</span>
                  </span>
                </button>
                <div v-if="openedReleases.has(release.date + release.title)" class="changelog-release-body">
                  <div v-for="(item, i) in release.items" :key="i" class="changelog-item">
                    <div class="changelog-main">
                      <span class="changelog-tag" :class="`tag-${item.tag}`">{{ changelogTagLabels[item.tag] }}</span>
                      <span class="changelog-text">{{ item.text }}</span>
                    </div>
                  </div>
                </div>
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
                <span class="ai-tip-desc">模型：<code>deepseek-flash</code>，接口地址：<code>https://api.deepseek.com/v1</code></span>
              </div>
              <div class="ai-tip-item">
                <span class="ai-tip-name">MiniMax</span>
                <span class="ai-tip-desc">模型：<code>MiniMax-M3.1-Flash</code></span>
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
                <el-select
                  v-if="currentAiPlugin.options?.[field]"
                  v-model="aiForm[field]"
                  :placeholder="getFieldPlaceholder(field)"
                  style="width: 100%"
                >
                  <el-option
                    v-for="opt in currentAiPlugin.options[field]"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <el-input
                  v-else
                  v-model="aiForm[field]"
                  :type="field === 'apiKey' ? 'password' : 'text'"
                  :placeholder="field === 'apiKey' ? (aiApiKeySet ? '已设置（输入新 Key 以修改）' : getFieldPlaceholder(field)) : getFieldPlaceholder(field)"
                  :show-password="field === 'apiKey'"
                />
                <div v-if="fieldHints[field]" class="field-hint">{{ fieldHints[field] }}</div>
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
            <div class="form-field" style="margin-top: 16px">
              <label>AI 填充并发数</label>
              <el-select v-model="aiFillConcurrency" style="width: 100%">
                <el-option label="1（最稳，限流套餐推荐）" :value="1" />
                <el-option label="2（默认）" :value="2" />
                <el-option label="3" :value="3" />
                <el-option label="5（最快，易触发限流）" :value="5" />
              </el-select>
              <div class="field-hint">同时向 AI 发起请求的书籍数量，MiniMax 个人版建议设为 1 或 2</div>
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
                  <el-tag :type="row.role === 'admin' ? 'primary' : 'info'" effect="plain">
                    {{ row.role === 'admin' ? '管理员' : '普通用户' }}
                  </el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="created_at" label="注册时间">
                <template #default="{ row }">
                  {{ formatServerTime(row.created_at, 'date') }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="260">
                <template #default="{ row }">
                  <el-button
                    v-if="row.id !== authStore.user?.id"
                    size="small"
                    link
                    type="primary"
                    @click="toggleRole(row)"
                  >
                    {{ row.role === 'admin' ? '降为普通' : '升为管理员' }}
                  </el-button>
                  <el-button size="small" link type="primary" @click="openPwdDialog(row)">
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
                      <el-button size="small" link type="danger">删除</el-button>
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
                <el-icon class="plugin-icon"><component :is="formatIcon(plugin.format)" /></el-icon>
                <div class="plugin-info">
                  <div class="plugin-name">{{ plugin.label }}</div>
                  <div class="plugin-desc">{{ plugin.description }}</div>
                </div>
                <template v-if="plugin.format === 'pdf'">
                  <div class="plugin-switch">
                    <span class="plugin-switch-label">{{ plugin.usePlugin ? '阅读器逐页显示' : '浏览器原生' }}</span>
                    <el-switch
                      :model-value="plugin.usePlugin"
                      @change="(val: string | number | boolean) => togglePdfPlugin(!!val)"
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
import { ref, reactive, computed, watch, onMounted, type Component } from 'vue'
import { formatServerTime } from '@/utils/time'
import { Setting, User, MagicStick, Cpu, Message, CopyDocument, Document, Notebook, Tickets, Collection, Files } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { settingsApi } from '@/api/settings'
import { applySiteTheme } from '@/utils/theme'
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
const aiPlugins = ref<Array<{ name: string; label: string; fields: string[]; placeholders?: Record<string, string>; options?: Record<string, Array<{ value: string; label: string }>> }>>([])
const readerPlugins = ref<Array<{ format: string; label: string; description: string; usePlugin?: boolean }>>([])
const selectedAiPlugin = ref('')
const aiSummaryLength = ref<number>(100)
const aiFillConcurrency = ref<number>(2)
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


// ── 更新说明 ── 新的记录加在最前面，页面只显示最近 5 次
type ChangelogTag = 'ui' | 'lib' | 'auth' | 'reader' | 'epub' | 'txt' | 'ai' | 'infra'
interface ChangelogRelease {
  date: string
  title: string
  items: Array<{ tag: ChangelogTag; text: string }>
}

const changelogTagLabels: Record<ChangelogTag, string> = {
  ui: '界面', lib: '书库', auth: '安全', reader: '阅读', epub: 'EPUB', txt: 'TXT', ai: 'AI', infra: '系统',
}

const changelog: ChangelogRelease[] = [
  {
    date: '2026-11-04',
    title: 'PDF 原版显示与 EPUB 修复',
    items: [
      { tag: 'ui', text: '界面精简：书库「AI已填充」改为封面角小圆点，手机端书库顶部压缩为两行；书页显示干净的书名、书架状态与「继续阅读 · 章节」；书架整行点击继续阅读；深色主题下按钮与下拉框统一为深色；图标不再依赖 emoji' },
      { tag: 'reader', text: '阅读器支持键盘：← / → 翻章，空格翻页，B 加书签；去掉右下角重复的书签按钮' },
      { tag: 'lib', text: '单本 AI 填充改为先预览：可修改简介等信息、增删标签和类似作品，从多张豆瓣封面或按分类风格生成的默认封面中选择，确认后才保存；预览时不再覆盖已锁定的字段' },
      { tag: 'reader', text: 'PDF 「阅读器逐页显示」模式（原「插件解析」）改为按原版逐页显示，封面图片、字体与排版和原文件一致；支持章节翻页 / 瀑布流、阅读进度与书签，手机上按屏幕宽度自适应' },
      { tag: 'reader', text: 'PDF 默认改为「阅读器逐页显示」（安卓等手机浏览器无法内嵌显示 PDF）；管理员在设置中手动关闭过的保持浏览器原生打开' },
      { tag: 'epub', text: '修复部分漫画 EPUB 第一页封面空白的问题（SVG 方式引用的图片此前未能加载）' },
      { tag: 'ai', text: 'MiniMax 跟进官方接口变更：默认模型改为 MiniMax-M3.1-Flash（MiniMax-M2 已下线，未填写模型时 AI 填充会失败），接口地址改为 api.minimax.cn' },
      { tag: 'ai', text: 'MiniMax 新增「推理强度」设置（仅 MiniMax-M3.1-Flash 生效）：调低可明显加快 AI 填充并减少消耗' },
      { tag: 'ai', text: 'DeepSeek 默认模型改为 deepseek-flash（旧名 deepseek-chat 已不在官方模型列表中），新增「思考模式」设置：默认关闭，速度与费用和之前一致，可按需开启并选择强度' },
      { tag: 'ai', text: 'Ollama 新增「思考模式」设置：默认关闭，qwen3、deepseek-r1 等支持思考的模型不再默认先思考，AI 填充明显更快；调用失败时显示 Ollama 返回的原因（如模型未下载、模型不支持思考）' },
      { tag: 'infra', text: 'EPUB 解析依赖的 adm-zip 升级到 0.6.1，修复恶意 ZIP 文件导致内存耗尽等安全漏洞' },
    ],
  },
  {
    date: '2026-11-03',
    title: '安全加固、阅读修复与性能优化',
    items: [
      { tag: 'auth', text: '访问令牌与刷新令牌区分用途，刷新令牌不能再直接调用接口（升级后需重新登录一次）' },
      { tag: 'auth', text: '用户被删除或角色变更后立即生效，无需等待令牌过期' },
      { tag: 'auth', text: '系统设置接口仅管理员可访问，且不再返回各用户的个人阅读设置' },
      { tag: 'infra', text: '修复"不能删除自己的账号"校验失效的问题' },
      { tag: 'auth', text: '修复扫描批次预览接口可读取书库目录外任意文件的问题，并改为只读取文件开头' },
      { tag: 'lib', text: '封面抓取不再生成调试文件，封面目录仅对外提供图片' },
      { tag: 'reader', text: '瀑布流模式书签记录章节内位置，点击书签可准确定位并继续加载后续章节' },
      { tag: 'reader', text: '章节模式记住章内阅读位置：按段落定位，改字号、页面宽度或换设备后仍能回到原处，直接关闭页面也会保存' },
      { tag: 'txt', text: '修复无章节标题的 TXT 按固定字节分段时把汉字切断导致段首段尾乱码的问题，分段改为对齐到行首' },
      { tag: 'ai', text: 'AI 填充只读取 TXT 开头部分并按实际编码解码，GBK 等编码的书不再给 AI 传入乱码，批量填充内存占用大幅降低' },
      { tag: 'reader', text: '阅读器解析缓存增加上限并合并同一本书的并发加载，长时间运行不再持续占用内存' },
      { tag: 'reader', text: 'PDF 使用浏览器原生打开时不再在后台完整解析整本 PDF，打开大 PDF 明显更快' },
      { tag: 'lib', text: '扫描清理已删除文件、删除书籍或用户时，同步清理书架、进度、书签等关联数据' },
      { tag: 'lib', text: '修复问题书籍页「仅删书库记录」实际会删除磁盘文件的问题，现在会保留文件；并补充重复关联、影响书架时的确认提示' },
      { tag: 'lib', text: '扫描时若某个子目录临时读取失败（如 NAS 网络抖动），其中的书不再被当作已删除而清理' },
      { tag: 'lib', text: '修复扫描审核中先调整（更换正本 / 剔除）再点「接受」会丢失调整内容的问题' },
      { tag: 'txt', text: 'TXT 编码修复改为原子写入（先写临时文件再替换），中途中断不会截断原文件，并保留原文件权限与所有者；修复后不再在下次扫描时被重复处理' },
      { tag: 'auth', text: '扫描审核只能在扫描结果范围内调整，阅读接口只读取书库目录内的文件，防止书库外文件被当作书籍读出' },
      { tag: 'auth', text: '管理员重置用户密码后，该用户此前登录的所有设备立即失效' },
      { tag: 'infra', text: '依赖安全更新：修复 DOMPurify、Express、Vue、Axios 等已知漏洞（均为兼容升级）' },
      { tag: 'ui', text: '修复书架「最近阅读」、书签、用户列表、审计日志等处时间显示相差 8 小时（Safari 下显示 NaN）的问题' },
      { tag: 'lib', text: '扫描导入支持 UMD 格式（此前阅读器支持但扫描时会被忽略）' },
      { tag: 'reader', text: '修复网络较慢时快速切章、或瀑布流后台加载时跳章，页面显示成错误章节的问题' },
      { tag: 'auth', text: '断网、服务器临时故障或请求过于频繁时不再把用户踢回登录页，网络恢复后可继续使用' },
      { tag: 'lib', text: '书库切换分类时回到第 1 页，不再因停留在不存在的页码而显示为空' },
      { tag: 'lib', text: '原书文件删除后，它的重复书自动恢复为普通书籍，不再被永久隐藏；重复书内容变化后不再残留旧的重复关系' },
      { tag: 'ai', text: 'AI 统一章节标题失败时保留原有结果，只替换成功的部分；同一本书同时运行不再报错' },
      { tag: 'infra', text: '为书籍文件路径建立索引，书多时扫描批次应用更快；邀请邮件内容转义并校验链接格式' },
      { tag: 'ui', text: '手机端优化：书库改为每行两本、搜索栏不再超出屏幕；阅读器正文在窄屏下占满宽度（每行由约 12 字增至 19 字）' },
      { tag: 'auth', text: '普通用户不再看到书籍在服务器上的文件路径；阅读接口出错时不再回显内部路径；只能为书库中存在的书保存进度和书签' },
      { tag: 'infra', text: '后端依赖大版本升级：zod 3→4、nodemailer 6→10；移除 uuid 依赖改用 Node 内置 crypto.randomUUID' },
      { tag: 'lib', text: '审核模式：「非重复，加入书库」的判定会被记住，已标记的乱码书不再重复提交审核，书库无变化时扫描不再反复产生待审核批次（可在「手动规则」中撤销判定）' },
      { tag: 'txt', text: 'TXT 第一个章节标题之前的内容（书名、作者、简介、前言等）现在显示在第一章开头，此前这部分无法阅读；章节划分与书籍指纹保持不变，无需重新扫描' },
      { tag: 'auth', text: '邀请码改用安全随机数生成；阅读设置保存时校验格式与大小' },
      { tag: 'ui', text: 'Element Plus 改为按需引入，首屏 JS 由约 1.2MB 降至约 160KB，页面打开更快' },
      { tag: 'reader', text: '瀑布流模式滚动处理节流，并最多保留 8 章内容，长时间连续阅读不再越来越卡' },
      { tag: 'txt', text: 'TXT / PDF / UMD 正文中的 <、>、& 等字符不再被误当作标签而丢失' },
      { tag: 'lib', text: '书籍指纹算法升级（v2），升级后首次扫描会重建全部指纹，耗时会比平时长' },
      { tag: 'infra', text: '移除未使用的后端依赖（multer、node-fetch、winston）' },
    ],
  },
  {
    date: '2026-06-05',
    title: '扫描导入重做与 AI 批量填充',
    items: [
      { tag: 'lib', text: '扫描导入重做：可选「暂存审核 / 自动写入」，自动识别重复书籍并分组、自动清理磁盘上已删除的书、从文件名提取作者；普通扫描即为快速增量同步，无需重建指纹' },
      { tag: 'ai', text: '新增 AI 批量填充书籍信息（作者、简介、分类、推荐标签、封面），支持失败重试与「重置全部填充」重跑；AI 填充并入扫描流程' },
      { tag: 'ai', text: '新增豆瓣评分：AI 填充时自动抓取，书库封面角标与书籍详情页显示评分，并支持按评分排序' },
      { tag: 'lib', text: '搜索框支持关键词筛选：输入「重复」查看重复书籍、「ai填充」查看已填充、「填充失败」查看失败；搜索框旁新增「?」用法说明' },
      { tag: 'ui', text: '书籍详情页新增推荐标签与「类似作品」（本库已有的可直接跳转），并修复类似作品链接跳转到错误书籍的问题' },
    ],
  },
  {
    date: '2026-06-04',
    title: 'EPUB 与 TXT 阅读增强',
    items: [
      { tag: 'txt', text: '修复 UTF-16 编码的 TXT 小说打开后乱码的问题，并将编码自动识别的采样范围扩大至 64KB，提升 GBK/中文文件的识别准确度' },
      { tag: 'epub', text: '漫画/图册 EPUB 自动切换全页流模式，不再跳过无 TOC 标题的页面（如柯南全 1457 页均可阅读）' },
      { tag: 'epub', text: '支持 EPUB 内嵌图片显示，图片通过独立 API 端点从 EPUB 包中提取并返回浏览器' },
      { tag: 'epub', text: '修复 EPUB 章节内链接点击后跳转错误（内部 href 现映射至正确章节索引）' },
      { tag: 'epub', text: '修复 EPUB 章节内容无法加载的问题（TOC id 与 flow id 不匹配导致 File not found）' },
      { tag: 'reader', text: '瀑布流模式：章节内容较短时自动预加载后续章节，确保从首章即可流畅下翻' },
    ],
  },
  {
    date: '2026-05-06',
    title: '书库与封面优化',
    items: [
      { tag: 'ui', text: '优化书库封面图片加载与样式展示' },
      { tag: 'lib', text: '扫描导入时自动清理已删除文件的数据库记录' },
    ],
  },
  {
    date: '2026-04-24',
    title: '登录认证重构',
    items: [
      { tag: 'auth', text: '重构登录 Token 处理，优化反馈功能' },
    ],
  },
]

const recentChangelog = changelog.slice(0, 5)
// 默认展开最近一次
const openedReleases = ref(new Set<string>(recentChangelog.length ? [recentChangelog[0].date + recentChangelog[0].title] : []))

function toggleRelease(key: string) {
  const next = new Set(openedReleases.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openedReleases.value = next
}

function openFeedback() {
  window.open('https://easyreader.ucool.uk/bbs', '_blank')
}

const fieldLabels: Record<string, string> = {
  apiKey: 'API Key',
  model: '模型',
  baseUrl: '接口地址',
  reasoningEffort: '推理强度',
  thinking: '思考模式',
}

const fieldHints: Record<string, string> = {
  reasoningEffort: '仅对 MiniMax-M3.1-Flash 生效；越低越快、消耗越少，书名与内容明确时 low 已足够',
  thinking: '开启后模型先推理再作答，结果可能更准确，但更慢、费用更高；书名与内容明确时无需开启。所选模型不支持思考时开启会报错',
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
  const icons: Record<string, Component> = { txt: Document, epub: Notebook, pdf: Tickets, umd: Collection }
  return icons[format] || Files
}

async function togglePdfPlugin(val: boolean) {
  await settingsApi.update({ pdf_use_plugin: val ? 'true' : 'false' })
  const plugin = readerPlugins.value.find(p => p.format === 'pdf')
  if (plugin) plugin.usePlugin = val
  ElMessage.success(val ? 'PDF 已切换为阅读器逐页显示（保留原版式，支持进度和书签）' : 'PDF 已切换为浏览器原生模式')
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
  const fillConcStored = parseInt(data['ai_fill_concurrency'] ?? '')
  if (Number.isFinite(fillConcStored) && fillConcStored >= 1 && fillConcStored <= 10) {
    aiFillConcurrency.value = fillConcStored
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
      payload['ai_fill_concurrency'] = String(aiFillConcurrency.value)
      for (const field of currentAiPlugin.value.fields) {
        // 下拉字段选「默认」时也要提交空值，以清除之前保存的设置
        if (aiForm[field] || currentAiPlugin.value.options?.[field]) {
          payload[`ai_${selectedAiPlugin.value}_${field}`] = aiForm[field] ?? ''
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
      applySiteTheme(sysForm.site_theme)
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
    inviteExpiry.value = formatServerTime(resp.data.data?.expiresAt, 'date')
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
  color: var(--accent);
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

.changelog-release {
  background: var(--bg-2);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 0.2s;
}

.changelog-release.is-open {
  border-color: var(--card-border);
}

.changelog-release-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  background: none;
  border: none;
  color: var(--text-1);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.changelog-release-header:hover .changelog-arrow,
.changelog-release-header:focus-visible .changelog-arrow {
  color: var(--accent);
}

.changelog-release-header:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.changelog-release-title .changelog-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.changelog-release-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.changelog-count {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-2);
}

.changelog-arrow {
  color: var(--text-2);
  transition: transform 0.2s, color 0.2s;
}

.changelog-release.is-open .changelog-arrow {
  transform: rotate(90deg);
}

.changelog-release-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 14px 12px;
}

.changelog-release-body .changelog-item {
  padding: 8px 0 0;
  background: none;
  border-top: 1px solid var(--card-border);
  border-radius: 0;
}

.changelog-release-body .changelog-item:first-child {
  border-top: none;
  padding-top: 0;
}

.changelog-item--plan {
  opacity: 0.75;
  border: 1px dashed var(--card-border);
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
  min-width: 48px;
  text-align: center;
  box-sizing: border-box;
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
