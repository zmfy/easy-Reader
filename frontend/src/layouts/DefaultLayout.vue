<template>
  <div class="app-layout">
    <!-- Mobile backdrop -->
    <transition name="fade">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    </transition>

    <!-- Sidebar -->
    <nav class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-logo">
        <span class="logo-tile"><IconBook2 :size="18" :stroke-width="2" /></span>
        <span class="logo-text">{{ siteName }}</span>
      </div>
      <div class="sidebar-nav">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="nav-item"
          :class="{ active: $route.path.startsWith(item.path) }"
          @click="sidebarOpen = false"
        >
          <component :is="item.icon" class="nav-icon" :size="19" :stroke-width="1.75" />
          <span>{{ item.label }}</span>
        </router-link>
      </div>
      <div class="sidebar-user">
        <div class="user-info">
          <div class="user-avatar">{{ authStore.user?.username?.[0]?.toUpperCase() }}</div>
          <div class="user-details">
            <div class="user-name">{{ authStore.user?.username }}</div>
            <div class="user-role">{{ authStore.user?.role === 'admin' ? '管理员' : '普通用户' }}</div>
          </div>
          <NotificationBell v-if="showBell" @navigate="sidebarOpen = false" />
          <el-popover
            ref="moreRef"
            trigger="click"
            placement="top-end"
            :width="196"
            :show-arrow="false"
            :offset="8"
            popper-class="user-menu-popper"
            @show="focusFirstItem"
            @hide="moreBtnRef?.focus()"
          >
            <template #reference>
              <button ref="moreBtnRef" class="more-btn" type="button" aria-label="更多"><IconDots :size="18" :stroke-width="1.75" /></button>
            </template>
            <div ref="menuRef" class="user-menu">
              <div class="menu-row" role="switch" :aria-checked="keepAlive" tabindex="0" @click="toggleKeepAlive" @keydown.enter.prevent="toggleKeepAlive" @keydown.space.prevent="toggleKeepAlive">
                <IconPlugConnected class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>保持连接</span>
                <el-switch :model-value="keepAlive" size="small" tabindex="-1" aria-hidden="true" class="menu-switch" />
              </div>
              <div v-if="installMode !== 'installed'" class="menu-row" role="button" tabindex="0" @click="closeMenu(); installApp()" @keydown.enter.prevent="closeMenu(); installApp()" @keydown.space.prevent="closeMenu(); installApp()">
                <IconDeviceMobileDown class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>安装到桌面</span>
              </div>
              <router-link to="/change-password" class="menu-row" @click="closeMenu(); sidebarOpen = false">
                <IconKey class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>修改密码</span>
              </router-link>
              <a :href="FEEDBACK_URL" target="_blank" rel="noopener noreferrer" class="menu-row" @click="closeMenu()">
                <IconMessageCircle class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>问题反馈</span>
                <span class="menu-meta">留言板</span>
              </a>
              <a :href="ISSUE_URL" target="_blank" rel="noopener noreferrer" class="menu-row" @click="closeMenu()">
                <IconBrandGithub class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>提交 Issue</span>
                <span class="menu-meta">GitHub</span>
              </a>
              <!-- 学习版以 AGPL-3.0 发布：网络用户可从这里获取对应源码（AGPL 第 13 条） -->
              <a :href="SOURCE_URL" target="_blank" rel="noopener noreferrer" class="menu-row" @click="closeMenu()">
                <IconCode class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>源码</span>
                <span class="menu-meta">AGPL-3.0</span>
              </a>
              <div class="menu-sep" />
              <div class="menu-row menu-row--danger" role="button" tabindex="0" @click="closeMenu(); handleLogout()" @keydown.enter.prevent="closeMenu(); handleLogout()" @keydown.space.prevent="closeMenu(); handleLogout()">
                <IconLogout class="menu-icon" :size="16" :stroke-width="1.75" />
                <span>退出登录</span>
              </div>
            </div>
          </el-popover>
        </div>
      </div>
    </nav>

    <!-- Main content -->
    <main class="main-content">
      <!-- Mobile top bar -->
      <div class="mobile-topbar">
        <button class="menu-toggle" @click="sidebarOpen = true" aria-label="打开菜单">
          <span class="hamburger" />
          <span class="hamburger" />
          <span class="hamburger" />
        </button>
        <span class="mobile-title">{{ siteName }}</span>
        <NotificationBell v-if="showBell" @navigate="sidebarOpen = false" />
      </div>
      <ScanProgressBar />
      <InstallHelpDialog
        v-if="installMode !== 'installed' && installMode !== 'prompt'"
        v-model="installHelpVisible"
        :mode="installMode"
      />
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
// 线条图标与 stock-agent 一致（Tabler Icons，按需打包）
import { IconBook2, IconBookmarks, IconBooks, IconBrandGithub, IconCode, IconDeviceMobileDown, IconDots, IconKey, IconLogout, IconMessageCircle, IconNotebook, IconPlugConnected, IconSettings2 } from '@tabler/icons-vue'
import { FEEDBACK_URL, ISSUE_URL } from '@/utils/links'
import { settingsApi } from '@/api/settings'
import { authApi } from '@/api/auth'
import ScanProgressBar from '@/components/ScanProgressBar.vue'
import InstallHelpDialog from '@/components/InstallHelpDialog.vue'
import { usePwaInstall } from '@/composables/usePwaInstall'
import NotificationBell from '@/components/NotificationBell.vue'
import { useSystemNoticeStore } from '@/stores/system-notice'

const SOURCE_URL = 'https://github.com/zmfy/easy-Reader/tree/study'

const authStore = useAuthStore()
const noticeStore = useSystemNoticeStore()
const router = useRouter()

// 铃铛只对管理员显示；「系统提醒」关闭（含环境变量关闭）时整个隐藏
// 关闭了「系统提醒」时，有后台任务通知也照样显示铃铛
const showBell = computed(() => authStore.isAdmin && (noticeStore.enabled || noticeStore.taskNotices.length > 0))

const siteName = ref('简单书房')
const sidebarOpen = ref(false)
const moreRef = ref<{ hide: () => void } | null>(null)
const moreBtnRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
function closeMenu() { moreRef.value?.hide() }

// 安装到桌面：支持安装提示的浏览器直接弹系统安装框，其余情况显示说明
const { mode: installMode, helpVisible: installHelpVisible, install: installApp } = usePwaInstall()
function focusFirstItem() { nextTick(() => menuRef.value?.querySelector<HTMLElement>('.menu-row')?.focus()) }
const keepAlive = ref(localStorage.getItem('keepAlive') === 'true')
let keepAliveTimer: ReturnType<typeof setInterval> | null = null

async function doRefresh() {
  const refreshToken = localStorage.getItem('refreshToken')
  if (!refreshToken) return
  try {
    const resp = await authApi.refresh(refreshToken)
    const data = resp.data.data!
    authStore.storeTokens(data)
  } catch { /* 刷新失败时由 http 拦截器处理 */ }
}

function startKeepAlive() {
  if (keepAliveTimer) return
  keepAliveTimer = setInterval(doRefresh, 5 * 60 * 1000)
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer)
    keepAliveTimer = null
  }
}

function toggleKeepAlive() {
  keepAlive.value = !keepAlive.value
  localStorage.setItem('keepAlive', String(keepAlive.value))
  if (keepAlive.value) {
    startKeepAlive()
    ElMessage.success('保活已开启')
  } else {
    stopKeepAlive()
    ElMessage.info('保活已关闭')
  }
}

onMounted(async () => {
  if (authStore.isAdmin) {
    void noticeStore.load()
    noticeStore.startTaskPolling()
  }
  try {
    const resp = await settingsApi.getPublic()
    if (resp.data.data?.site_name) siteName.value = resp.data.data.site_name
  } catch { /* keep default */ }
  if (keepAlive.value) startKeepAlive()
})

onUnmounted(() => {
  stopKeepAlive()
  noticeStore.stopTaskPolling()
})

const navItems = [
  { path: '/library', label: '书库', icon: IconBooks },
  { path: '/shelf', label: '书架', icon: IconBookmarks },
  { path: '/notes', label: '笔记', icon: IconNotebook },
  ...(authStore.isAdmin ? [{ path: '/settings', label: '设置', icon: IconSettings2 }] : []),
]

async function handleLogout() {
  await authStore.logout()
  ElMessage.success('已退出登录')
  router.push('/login')
}
</script>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
  border-right: 1px solid var(--card-border);
  display: flex;
  flex-direction: column;
  z-index: 150;
}

.sidebar-logo {
  padding: 28px 24px 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid var(--card-border);
}

/* logo：强调色渐变圆角方块 + --on-accent 图标（多数主题为白色） */
.logo-tile {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent);
  background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 78%, #000));
  box-shadow: 0 3px 8px color-mix(in srgb, var(--accent) 30%, transparent);
}

.logo-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: 2px;
}

.sidebar-nav {
  flex: 1;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: var(--radius-md);
  color: var(--text-2);
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  transition: all 0.18s ease;
}
/* 悬停 / 选中底色由当前主题强调色派生；选中项左侧加强调色竖条 */
.nav-item:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-1); }
.nav-item.active { background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); font-weight: 600; }
.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 3px;
  background: var(--accent);
}
.nav-icon { flex: none; }

.sidebar-user {
  padding: 16px;
  border-top: 1px solid var(--card-border);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: var(--on-accent);
  font-size: 14px;
  flex-shrink: 0;
}

.user-details { flex: 1; min-width: 0; }

.user-name {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role { font-size: 11px; color: var(--text-2); }

.more-btn {
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}
.more-btn:hover,
.more-btn:focus-visible { background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text-1); outline: none; }

/* ── Main content ── */
.main-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-0);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Mobile top bar — hidden on desktop */
.mobile-topbar {
  display: none;
}

/* ── Backdrop ── */
.sidebar-backdrop {
  display: none;
}

.fade-enter-active,
.fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }

/* ── Mobile ── */
@media (max-width: 768px) {
  /* Sidebar becomes a fixed overlay panel */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 260px;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }
  /* 阴影只在展开时加：收起时阴影会从屏幕左缘漏出一条灰边 */
  .sidebar.open {
    transform: translateX(0);
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
  }

  /* Main content takes full width */
  .main-content {
    width: 100%;
  }

  /* Backdrop covers content when sidebar is open */
  .sidebar-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 140;
    backdrop-filter: blur(2px);
  }

  /* Top bar with hamburger */
  .mobile-topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 52px;
    flex-shrink: 0;
    background: var(--bg-1);
    border-bottom: 1px solid var(--card-border);
    position: sticky;
    top: 0;
    z-index: 50;
  }

  .menu-toggle {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
    width: 36px;
    height: 36px;
    padding: 6px;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: var(--radius-md);
    flex-shrink: 0;
    transition: background 0.15s ease;
  }
  .menu-toggle:active { background: var(--accent-soft); }

  .hamburger {
    display: block;
    width: 100%;
    height: 2px;
    background: var(--text-1);
    border-radius: 2px;
    transition: background 0.15s ease;
  }

  .mobile-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-0);
    letter-spacing: 1px;
    flex: 1;
  }
}
</style>

<style>
/* 弹层挂在 body 下，样式不能 scoped */
.el-popover.user-menu-popper {
  padding: 6px;
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-soft);
  max-width: calc(100vw - 24px);
}
.user-menu-popper .menu-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 10px;
  border-radius: 8px;
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
  text-decoration: none;
  user-select: none;
  transition: background 0.15s ease;
}
.user-menu-popper .menu-row span { flex: 1; }
.user-menu-popper .menu-row .menu-meta { flex: none; font-size: 11px; color: var(--text-2); }
.user-menu-popper .menu-icon { flex: none; color: var(--text-2); }
.user-menu-popper .menu-row:hover,
.user-menu-popper .menu-row:focus-visible { background: color-mix(in srgb, var(--accent) 10%, transparent); outline: none; }
.user-menu-popper .menu-switch { pointer-events: none; flex: none; }
.user-menu-popper .menu-sep { height: 1px; margin: 4px 6px; background: var(--card-border); }
.user-menu-popper .menu-row--danger,
.user-menu-popper .menu-row--danger .menu-icon { color: var(--danger); }
.user-menu-popper .menu-row--danger:hover,
.user-menu-popper .menu-row--danger:focus-visible { background: color-mix(in srgb, var(--danger) 10%, transparent); }
</style>
