<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="设置" />

      <div class="segmented settings-tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          role="tab"
          class="segmented-item"
          :class="{ 'is-active': activeTab === tab.key }"
          :aria-selected="activeTab === tab.key"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- System Settings -->
      <div v-if="activeTab === 'system'" class="setting-section">
        <section class="section-card">
          <h2 class="section-title">站点信息</h2>
          <div class="form-grid">
            <div class="form-field">
              <label>站点名称</label>
              <el-input v-model="sysForm.site_name" placeholder="留空则使用默认：简单书房" />
            </div>
            <div class="form-field">
              <label>站点副标题</label>
              <el-input v-model="sysForm.site_subtitle" placeholder="留空则使用默认：Easy Reader · NAS Novel Platform" />
            </div>
            <div class="form-field span-2">
              <label>站点公开地址</label>
              <el-input v-model="sysForm.site_url" placeholder="https://your-domain.com:36485" />
              <div class="form-hint">用于生成邀请链接，留空则自动使用当前访问地址</div>
            </div>
          </div>
        </section>

        <section class="section-card">
          <h2 class="section-title">书库</h2>
          <div class="form-grid">
            <div class="form-field">
              <label>书库目录</label>
              <el-input v-model="sysForm.books_dir" placeholder="/app/books" />
            </div>
          </div>
        </section>

        <section class="section-card">
          <h2 class="section-title">外观主题</h2>
          <p class="section-desc">网站整体配色，保存后生效</p>
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
              <div v-if="sysForm.site_theme === t.key" class="theme-check">
                <IconCheck :size="14" :stroke-width="1.75" />
              </div>
            </div>
          </div>
          <div class="section-actions">
            <el-button type="primary" :loading="saving" @click="saveSettings('system')">保存系统设置</el-button>
          </div>
        </section>
      </div>

      <!-- SMTP Settings (暂时隐藏) -->
      <!-- <div v-if="activeTab === 'smtp'" class="setting-section"> ... </div> -->

      <!-- Changelog / Feedback -->
      <div v-if="activeTab === 'feedback'" class="setting-section">
        <section class="section-card">
          <h2 class="section-title">系统提醒</h2>
          <p class="section-desc">{{ updateStatus?.envDisabled ? '已通过环境变量关闭' : '在侧栏铃铛提示新版本与配置问题；关闭后停止后台检查更新' }}</p>
          <div class="notice-switch">
            <span class="notice-switch-label">开启系统提醒</span>
            <el-switch
              :model-value="updateStatus?.noticeEnabled ?? false"
              :disabled="!updateStatus || updateStatus.envDisabled"
              :loading="savingNotice"
              @change="(val: string | number | boolean) => toggleSystemNotice(!!val)"
            />
          </div>
          <div class="update-status">
            <div class="update-status-main">
              <span class="update-current">当前版本 {{ currentVersionLabel }}</span>
              <span class="update-remote" :class="{ 'is-new': (updateStatus?.newer.length ?? 0) > 0, 'is-error': !!updateStatus?.error }">{{ updateStatusText }}</span>
            </div>
            <el-button
              size="small"
              :loading="checkingUpdate"
              :disabled="updateStatus?.noticeEnabled === false"
              @click="checkUpdatesNow"
            >
              立即检查
            </el-button>
          </div>
        </section>

        <section class="section-card">
          <h2 class="section-title">版本记录</h2>
          <p v-if="changelogMissing" class="section-desc">未找到更新说明文件</p>
          <p v-else-if="releases.length === 0" class="section-desc">暂无已发布版本</p>
          <p v-else class="section-desc">最近 {{ releases.length }} 次更新，点击标题查看本次调整内容。</p>
          <div class="changelog-list">
            <div
              v-for="release in releases"
              :key="release.version"
              class="changelog-release"
              :class="{ 'is-open': openedReleases.has(release.version) }"
            >
              <button
                type="button"
                class="changelog-release-header"
                :aria-expanded="openedReleases.has(release.version)"
                @click="toggleRelease(release.version)"
              >
                <span class="changelog-release-title">
                  v{{ release.version }}<template v-if="release.date"> · <span class="changelog-date">{{ release.date }}</span></template>
                </span>
                <IconChevronRight class="changelog-arrow" :size="16" :stroke-width="1.75" />
              </button>
              <div v-if="release.intro" class="changelog-intro">{{ release.intro }}</div>
              <div v-if="openedReleases.has(release.version)" class="changelog-release-body">
                <div v-for="(section, si) in release.sections" :key="si" class="changelog-section">
                  <div class="changelog-section-title">{{ section.title }}</div>
                  <div v-for="(item, i) in section.items" :key="i" class="changelog-item">
                    <div class="changelog-main">
                      <span v-if="item.actionRequired" class="changelog-tag">需操作</span>
                      <span class="changelog-text"><template v-for="(seg, k) in boldSegments(item.text)" :key="k"><strong v-if="seg.bold">{{ seg.text }}</strong><template v-else>{{ seg.text }}</template></template></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="section-actions">
            <el-button type="primary" @click="openFeedback">
              意见反馈
            </el-button>
          </div>
        </section>
      </div>

      <!-- AI Settings -->
      <div v-if="activeTab === 'ai'" class="setting-section">
        <section class="section-card">
          <h2 class="section-title">AI 插件</h2>
          <p class="section-desc">用于 AI 填充书籍信息、自动分类与听书语音</p>
          <div class="note ai-tips">
            <div class="ai-tip-title">已测试通过的配置</div>
            <div class="ai-tip-item">
              <span class="ai-tip-name">DeepSeek</span>
              <span class="ai-tip-desc">模型：<code>deepseek-flash</code>，接口地址：<code>https://api.deepseek.com/v1</code></span>
            </div>
            <div class="ai-tip-item">
              <span class="ai-tip-name">MiniMax</span>
              <span class="ai-tip-desc">模型：<code>MiniMax-M3.1-Flash</code></span>
            </div>
            <div class="ai-tip-item">
              <span class="ai-tip-name">AI 语音</span>
              <span class="ai-tip-desc">听书的 AI 语音目前只支持 MiniMax（选择 MiniMax 后开启「听书功能」），其他插件暂不支持；未开启时阅读器的听书使用浏览器自带语音</span>
            </div>
          </div>
          <div v-if="aiConfigWarning" class="note note--warning ai-warning">
            <IconAlertTriangle class="ai-warning-icon" :size="16" :stroke-width="1.75" />
            <span>{{ aiConfigWarning }}</span>
          </div>
          <div class="form-grid">
            <div class="form-field">
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
            <template v-if="currentAiPlugin">
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
                <div v-if="fieldHints[field]" class="form-hint">{{ fieldHints[field] }}</div>
              </div>
            </template>
          </div>
        </section>

        <section class="section-card">
          <h2 class="section-title">高级参数</h2>
          <div class="form-grid">
            <div class="form-field">
              <label>书籍简介长度（字）</label>
              <el-select v-model="aiSummaryLength" style="width: 100%">
                <el-option label="50 字（极简）" :value="50" />
                <el-option label="100 字（默认）" :value="100" />
                <el-option label="200 字" :value="200" />
                <el-option label="300 字" :value="300" />
                <el-option label="500 字" :value="500" />
              </el-select>
              <div class="form-hint">影响 AI 填充 + 批量填充时生成的简介字数</div>
            </div>
            <div class="form-field">
              <label>AI 填充并发数</label>
              <el-select v-model="aiFillConcurrency" style="width: 100%">
                <el-option label="1（最稳，限流套餐推荐）" :value="1" />
                <el-option label="2（默认）" :value="2" />
                <el-option label="3" :value="3" />
                <el-option label="5（最快，易触发限流）" :value="5" />
              </el-select>
              <div class="form-hint">同时向 AI 发起请求的书籍数量，MiniMax 个人版建议设为 1 或 2</div>
            </div>
          </div>
          <div class="section-actions">
            <el-button type="primary" :loading="saving" @click="saveSettings('ai')">保存 AI 设置</el-button>
          </div>
        </section>
      </div>

      <!-- User Management -->
      <div v-if="activeTab === 'users'" class="setting-section">
        <section class="section-card section-card--flush">
          <div class="card-head">
            <h2 class="section-title">用户</h2>
            <el-button type="primary" size="small" @click="openInviteDialog" :loading="creatingInvite">
              生成邀请码
            </el-button>
          </div>
          <el-table :data="users" stripe>
            <el-table-column prop="username" label="用户名" />
            <el-table-column prop="role" label="角色">
              <template #default="{ row }">
                <el-tag :type="row.role === 'admin' ? 'primary' : 'info'">
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
        </section>
      </div>

      <!-- Plugin Info -->
      <div v-if="activeTab === 'plugins'" class="setting-section">
        <section class="section-card">
          <h2 class="section-title">阅读插件</h2>
          <p class="section-desc">负责解析书籍文件，按格式自动选用</p>
          <div class="plugin-list">
            <div v-for="plugin in readerPlugins" :key="plugin.format" class="plugin-row">
              <component :is="formatIcon(plugin.format)" class="plugin-icon" :size="20" :stroke-width="1.75" />
              <div class="plugin-info">
                <div class="plugin-name">{{ plugin.label }}</div>
                <div class="plugin-desc">{{ plugin.description }}</div>
              </div>
              <el-tag type="success">已加载</el-tag>
            </div>
          </div>
        </section>

        <section v-if="pdfPlugin" class="section-card">
          <h2 class="section-title">PDF 显示方式</h2>
          <p class="section-desc">阅读器逐页显示保留原版式，支持进度和书签；关闭后用浏览器原生方式打开</p>
          <div class="plugin-switch">
            <el-switch
              :model-value="pdfPlugin.usePlugin"
              @change="(val: string | number | boolean) => togglePdfPlugin(!!val)"
            />
            <span class="plugin-switch-label">{{ pdfPlugin.usePlugin ? '阅读器逐页显示' : '浏览器原生' }}</span>
          </div>
        </section>
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
              <IconCopy :size="14" :stroke-width="1.75" />
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
            <IconCheck v-if="pwdRules.minLen" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />至少 8 位
          </div>
          <div class="pwd-rule" :class="pwdRules.hasUpper ? 'pass' : 'fail'">
            <IconCheck v-if="pwdRules.hasUpper" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />至少 1 个大写字母
          </div>
          <div class="pwd-rule" :class="pwdRules.hasLower ? 'pass' : 'fail'">
            <IconCheck v-if="pwdRules.hasLower" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />至少 1 个小写字母
          </div>
          <div class="pwd-rule" :class="pwdRules.hasNumber ? 'pass' : 'fail'">
            <IconCheck v-if="pwdRules.hasNumber" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />至少 1 个数字
          </div>
          <div class="pwd-rule" :class="pwdRules.hasSpecial ? 'pass' : 'fail'">
            <IconCheck v-if="pwdRules.hasSpecial" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />至少 1 个特殊字符（如 !@#$%^&*）
          </div>
          <div class="pwd-rule" :class="pwdRules.matched ? 'pass' : 'fail'">
            <IconCheck v-if="pwdRules.matched" class="rule-icon" :size="14" :stroke-width="1.75" /><IconX v-else class="rule-icon" :size="14" :stroke-width="1.75" />两次密码一致
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
import { formatServerTime, parseServerTime } from '@/utils/time'
import { passwordRules, passwordValid } from '@/utils/password-policy'
import { IconAlertTriangle, IconBook, IconBooks, IconCheck, IconChevronRight, IconCopy, IconFile, IconFileText, IconFileTypePdf, IconX } from '@tabler/icons-vue'
import { ElMessage } from 'element-plus'
import { useRoute } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import { settingsApi } from '@/api/settings'
import { boldSegments } from '@/utils/inline-bold'
import { buildAiSettingsPayload } from '@/utils/ai-settings'
import { applySiteTheme, DEFAULT_THEME } from '@/utils/theme'
import { useAuthStore } from '@/stores/auth'
import { useSystemNoticeStore } from '@/stores/system-notice'
import type { Release, UpdateStatus } from '@/types'

const authStore = useAuthStore()
const noticeStore = useSystemNoticeStore()
const route = useRoute()

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

const pwdRules = computed(() => passwordRules(pwdForm.newPassword, pwdForm.confirmPassword))

const pwdValid = computed(() => passwordValid(pwdRules.value))

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
  site_theme: DEFAULT_THEME,
})

const siteThemes = [
  {
    key: 'indigo',
    label: '靛青',
    desc: '明亮白卡靛蓝（默认）',
    bg: '#eef1f6',
    panel: '#ffffff',
    accent: '#4338ca',
    text: '#4a5568',
  },
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
  { key: 'system', label: '系统' },
  // { key: 'smtp', label: '邮件' },  // 暂时隐藏邮件设置
  { key: 'ai', label: 'AI 设置' },
  { key: 'users', label: '用户管理' },
  { key: 'plugins', label: '插件' },
  { key: 'feedback', label: '更新说明' },
]


// ── 更新说明 ──
const releases = ref<Release[]>([])
const changelogMissing = ref(false)
const updateStatus = ref<UpdateStatus | null>(null)
const checkingUpdate = ref(false)
const savingNotice = ref(false)
// 默认展开最近一次
const openedReleases = ref(new Set<string>())

const currentVersionLabel = computed(() => {
  const v = updateStatus.value?.currentVersion
  return v ? `v${v}` : '未知'
})

const updateStatusText = computed(() => {
  const st = updateStatus.value
  if (!st) return ''
  if (!st.noticeEnabled) return '已关闭更新检查'
  const newer = st.newer.length ? `有新版本 v${st.newer[0].version}${st.currentVersion ? '' : '（当前版本未知）'}` : ''
  if (st.error) {
    const d = parseServerTime(st.checkedAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    const t = d ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}` : ''
    const err = t ? `无法连接更新源，上次检查 ${t}` : '无法连接更新源'
    return newer ? `${newer}（${err}）` : err
  }
  if (newer) return newer
  if (!st.checkedAt) return '尚未检查'
  return '已是最新'
})

async function loadChangelog() {
  const [statusResp, logResp] = await Promise.all([
    settingsApi.getUpdateStatus(),
    settingsApi.getChangelog(),
  ])
  updateStatus.value = statusResp.data.data ?? null
  noticeStore.setStatus(updateStatus.value)
  const log = logResp.data.data
  if (!log) return
  releases.value = log.releases
  changelogMissing.value = log.missing
  if (log.releases.length) openedReleases.value = new Set([log.releases[0].version])
}

async function checkUpdatesNow() {
  checkingUpdate.value = true
  try {
    const resp = await settingsApi.checkUpdates()
    updateStatus.value = resp.data.data ?? updateStatus.value
    noticeStore.setStatus(updateStatus.value)
  } catch {
    ElMessage.error('检查失败，请稍后再试')
  } finally {
    checkingUpdate.value = false
  }
}

async function toggleSystemNotice(enabled: boolean) {
  savingNotice.value = true
  try {
    await settingsApi.setSystemNotice(enabled)
    // 重新获取状态，铃铛随之显示 / 隐藏
    const resp = await settingsApi.getUpdateStatus()
    updateStatus.value = resp.data.data ?? updateStatus.value
    noticeStore.setStatus(updateStatus.value)
    ElMessage.success(enabled ? '系统提醒已开启' : '系统提醒已关闭')
  } catch {
    ElMessage.error('保存失败，请稍后再试')
  } finally {
    savingNotice.value = false
  }
}

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
  ttsEnabled: '听书功能',
  ttsModel: '听书模型',
  ttsVoice: '听书音色',
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
  const icons: Record<string, Component> = { txt: IconFileText, epub: IconBook, pdf: IconFileTypePdf, umd: IconBooks }
  return icons[format] || IconFile
}

const pdfPlugin = computed(() => readerPlugins.value.find(p => p.format === 'pdf'))

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

const aiConfigWarning = ref<string | null>(null)

async function loadAiConfigWarning() {
  // 刷新失败静默处理，保持旧提醒，不影响保存提示与其他加载
  try {
    const resp = await settingsApi.getAiStatus()
    aiConfigWarning.value = resp.data.data?.config_warning ?? null
  } catch { /* ignore */ }
}

async function loadSettings() {
  const resp = await settingsApi.get()
  const data = resp.data.data || {}
  settingsData.value = data

  sysForm.site_name = data['site_name'] || ''
  sysForm.site_subtitle = data['site_subtitle'] || ''
  sysForm.site_url = data['site_url'] || ''
  sysForm.books_dir = data['books_dir'] || '/app/books'
  sysForm.site_theme = data['site_theme'] || DEFAULT_THEME

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
      Object.assign(payload, buildAiSettingsPayload(
        selectedAiPlugin.value,
        currentAiPlugin.value.fields,
        aiForm,
        aiSummaryLength.value,
        aiFillConcurrency.value,
      ))
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
    if (tab === 'ai') await loadAiConfigWarning()
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

// 铃铛「去设置」带 ?tab=ai：只接受已有的 tab key
function applyQueryTab() {
  const queryTab = Array.isArray(route.query.tab) ? route.query.tab[0] : route.query.tab
  if (queryTab && tabs.some(t => t.key === queryTab)) activeTab.value = queryTab
}
watch(() => route.query.tab, applyQueryTab)

onMounted(async () => {
  applyQueryTab()
  loadAiConfigWarning()
  await Promise.all([loadSettings(), loadPlugins(), loadUsers(), loadChangelog().catch(() => {})])
})
</script>

<style scoped>
.settings-tabs {
  margin-bottom: 20px;
}

.setting-section {
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 卡片没有说明行时，小标题与表单之间留出间距 */
.section-title + .form-grid {
  margin-top: 16px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-1);
}

.form-field .form-hint {
  margin-top: 0;
}

/* 贴边卡片（表格）的标题行 */
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 24px;
  border-bottom: 1px solid var(--card-border);
}

.card-head .section-title {
  margin: 0;
}

/* ── AI ── */
.ai-tips {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}

.ai-tip-title {
  font-weight: 600;
  color: var(--accent);
}

.ai-tip-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.ai-tip-name {
  color: var(--text-0);
  font-weight: 600;
  min-width: 64px;
  flex-shrink: 0;
}

.ai-tip-desc {
  color: var(--text-1);
}

.ai-tip-desc code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--card-bg);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  padding: 0 5px;
  border-radius: 4px;
}

.ai-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}

.ai-warning-icon {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--warning);
}

/* ── 插件 ── */
.plugin-list {
  display: flex;
  flex-direction: column;
}

.plugin-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid var(--card-border);
}

.plugin-row:first-child {
  border-top: none;
  padding-top: 0;
}

.plugin-row:last-child {
  padding-bottom: 0;
}

.plugin-icon {
  flex-shrink: 0;
  color: var(--accent);
}

.plugin-info {
  flex: 1;
  min-width: 0;
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
  gap: 10px;
}

.plugin-switch-label {
  font-size: 13px;
  color: var(--text-1);
}

/* Invite Dialog */
.invite-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.invite-code-block {
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
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
  color: var(--accent);
  letter-spacing: 4px;
}

.invite-action {
  border: 1px solid var(--card-border);
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

.invite-url-row .el-button :deep(> span) {
  gap: 4px;
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
.theme-cards {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 130px;
  border-radius: var(--radius-md);
  border: 2px solid var(--card-border);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s ease, transform 0.15s ease;
}
.theme-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent-line);
}
.theme-card.active {
  border-color: var(--accent);
}

/* 预览色块为各主题的示意色（例外：主题预览色卡），由模板内联给出 */
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
  flex: 1;
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
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
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
  color: var(--success);
}

.pwd-rule.fail {
  color: var(--text-2);
}

.rule-icon {
  flex-shrink: 0;
}

/* ── 更新说明 ── */
.notice-switch {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  font-size: 14px;
}

.notice-switch-label {
  font-weight: 500;
  color: var(--text-1);
}

.update-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--bg-2);
  border-radius: var(--radius-md);
  font-size: 14px;
}

.update-status-main {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.update-current {
  font-weight: 600;
  color: var(--text-1);
}

.update-remote {
  font-size: 13px;
  color: var(--text-2);
}

.update-remote.is-new {
  color: var(--accent);
  font-weight: 600;
}

.update-remote.is-error {
  color: var(--warning);
}

.changelog-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.changelog-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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

.changelog-date {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.changelog-arrow {
  flex-shrink: 0;
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
  padding-top: 8px;
  border-top: 1px solid var(--card-border);
}

.changelog-release-body .changelog-item:first-child {
  border-top: none;
  padding-top: 0;
}

.changelog-main {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
}

.changelog-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  margin-top: 1px;
  box-sizing: border-box;
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
}

.changelog-section + .changelog-section {
  margin-top: 8px;
}

.changelog-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  padding: 4px 0;
}

.changelog-intro {
  padding: 0 14px 10px;
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}

.changelog-text {
  line-height: 1.6;
}

@media (max-width: 768px) {
  .settings-tabs {
    margin-bottom: 16px;
  }

  .card-head {
    padding: 12px 16px;
  }

  .ai-tip-item {
    flex-direction: column;
    gap: 2px;
  }

  /* 主题卡片在手机上一行三张 */
  .theme-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .theme-card {
    width: auto;
  }
}
</style>
