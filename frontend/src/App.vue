<template>
  <router-view v-slot="{ Component, route }">
    <transition name="page" mode="out-in">
      <component :is="Component" :key="route.path" />
    </transition>
  </router-view>
  <OfflineNotice />
  <PwaUpdatePrompt v-if="pwaEnabled" />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { settingsApi } from '@/api/settings'
import { applySiteTheme } from '@/utils/theme'
import OfflineNotice from '@/components/OfflineNotice.vue'
import PwaUpdatePrompt from '@/components/PwaUpdatePrompt.vue'

// 浏览器只在安全上下文（HTTPS / localhost）允许 Service Worker；开发模式不注册
const pwaEnabled = import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator

const authStore = useAuthStore()

async function applySiteTitle() {
  try {
    const resp = await settingsApi.getPublic()
    const { site_name, site_theme } = resp.data.data || {}
    if (site_name) document.title = site_name
    if (site_theme) applySiteTheme(site_theme)
  } catch {
    // keep defaults
  }
}

onMounted(async () => {
  await applySiteTitle()
  if (authStore.isLoggedIn) {
    await authStore.fetchMe()
  }
})
</script>
