<template>
  <router-view v-slot="{ Component, route }">
    <transition name="page" mode="out-in">
      <component :is="Component" :key="route.path" />
    </transition>
  </router-view>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { settingsApi } from '@/api/settings'

const authStore = useAuthStore()

async function applySiteTitle() {
  try {
    const resp = await settingsApi.getPublic()
    const { site_name, site_theme } = resp.data.data || {}
    if (site_name) document.title = site_name
    if (site_theme) document.documentElement.dataset.theme = site_theme
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
