<template>
  <div class="app-layout">
    <nav class="sidebar">
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
        <el-button link class="logout-btn" @click="handleLogout">退出</el-button>
      </div>
    </nav>
    <main class="main-content">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { settingsApi } from '@/api/settings'

const authStore = useAuthStore()
const router = useRouter()

const siteName = ref('夜航书房')

onMounted(async () => {
  try {
    const resp = await settingsApi.getPublic()
    if (resp.data.data?.site_name) siteName.value = resp.data.data.site_name
  } catch { /* keep default */ }
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

.sidebar {
  width: 220px;
  flex-shrink: 0;
  background: linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
  border-right: 1px solid rgba(124, 92, 255, 0.1);
  display: flex;
  flex-direction: column;
  padding: 0;
  position: relative;
  z-index: 10;
}

.sidebar-logo {
  padding: 28px 24px 24px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(124, 92, 255, 0.08);
}

.logo-icon {
  font-size: 24px;
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

.nav-item:hover {
  background: rgba(124, 92, 255, 0.1);
  color: var(--text-1);
}

.nav-item.active {
  background: rgba(124, 92, 255, 0.2);
  color: var(--accent);
}

.nav-item .el-icon {
  font-size: 18px;
}

.sidebar-user {
  padding: 16px;
  border-top: 1px solid rgba(124, 92, 255, 0.08);
}

.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
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
}

.user-details {
  flex: 1;
  min-width: 0;
}

.user-name {
  font-size: 13px;
  color: var(--text-1);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-role {
  font-size: 11px;
  color: var(--text-2);
}

.logout-btn {
  color: var(--text-2) !important;
  font-size: 12px;
  padding: 0 !important;
}

.logout-btn:hover {
  color: var(--danger) !important;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-0);
}
</style>
