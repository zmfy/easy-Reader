<template>
  <div class="app-layout">
    <!-- Mobile backdrop -->
    <transition name="fade">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    </transition>

    <!-- Sidebar -->
    <nav class="sidebar" :class="{ open: sidebarOpen }">
      <div class="sidebar-logo">
        <span class="logo-icon">📖</span>
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
          <el-icon><component :is="item.icon" /></el-icon>
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
        </div>
        <div class="action-row" @click="toggleKeepAlive">
          <el-icon><component is="Stopwatch" /></el-icon>
          <span>保持连接</span>
          <div class="toggle-track" :class="{ on: keepAlive }">
            <div class="toggle-knob" />
          </div>
        </div>
        <div class="action-row action-row--logout" @click="handleLogout">
          <el-icon><component is="SwitchButton" /></el-icon>
          <span>退出登录</span>
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
      </div>
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { settingsApi } from '@/api/settings'
import { authApi } from '@/api/auth'

const authStore = useAuthStore()
const router = useRouter()

const siteName = ref('简单书房')
const sidebarOpen = ref(false)
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
  try {
    const resp = await settingsApi.getPublic()
    if (resp.data.data?.site_name) siteName.value = resp.data.data.site_name
  } catch { /* keep default */ }
  if (keepAlive.value) startKeepAlive()
})

onUnmounted(() => {
  stopKeepAlive()
})

const navItems = [
  { path: '/library', label: '书库', icon: 'Collection' },
  { path: '/shelf', label: '书架', icon: 'Reading' },
  ...(authStore.isAdmin ? [{ path: '/settings', label: '设置', icon: 'Setting' }] : []),
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
  border-right: 1px solid rgba(124, 92, 255, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 150;
}

.sidebar-logo {
  padding: 28px 24px 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(124, 92, 255, 0.08);
}

.logo-icon { font-size: 24px; }

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
.nav-item:hover { background: rgba(124, 92, 255, 0.1); color: var(--text-1); }
.nav-item.active { background: rgba(124, 92, 255, 0.2); color: var(--accent); }
.nav-item .el-icon { font-size: 18px; }

.sidebar-user {
  padding: 16px;
  border-top: 1px solid rgba(124, 92, 255, 0.08);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(124, 92, 255, 0.08);
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
  color: white;
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

.action-row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-2);
  font-size: 13px;
  transition: all 0.15s ease;
  user-select: none;
}
.action-row span { flex: 1; }
.action-row .el-icon { font-size: 15px; flex-shrink: 0; }
.action-row:hover { color: var(--text-1); background: rgba(124, 92, 255, 0.08); }
.action-row--logout:hover { color: var(--danger, #ef4444); background: rgba(239, 68, 68, 0.07); }

/* CSS toggle switch */
.toggle-track {
  width: 30px;
  height: 17px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.12);
  position: relative;
  transition: background 0.22s ease;
  flex-shrink: 0;
}
.toggle-track.on { background: var(--accent); }
.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.22s ease;
}
.toggle-track.on .toggle-knob { transform: translateX(13px); }

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
    box-shadow: 4px 0 24px rgba(0, 0, 0, 0.4);
  }
  .sidebar.open {
    transform: translateX(0);
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
    border-bottom: 1px solid rgba(124, 92, 255, 0.1);
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
  .menu-toggle:active { background: rgba(124, 92, 255, 0.15); }

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
