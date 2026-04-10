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
    const name = resp.data.data?.site_name
    if (name) document.title = name
  } catch {
    // keep default title from index.html
  }
}

onMounted(async () => {
  await applySiteTitle()
  if (authStore.isLoggedIn) {
    await authStore.fetchMe()
  }
})
</script>
