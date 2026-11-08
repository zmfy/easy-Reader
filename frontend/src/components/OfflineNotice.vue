<template>
  <transition name="offline-bar">
    <div v-if="offline || serverUnreachable" class="offline-bar" role="alert">
      <IconWifiOff :size="16" :stroke-width="1.75" />
      <span>没有网络连接</span>
      <button type="button" class="offline-retry" @click="retry">重试</button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { IconWifiOff } from '@tabler/icons-vue'
import { serverUnreachable } from '@/utils/network-status'

const offline = ref(typeof navigator !== 'undefined' && navigator.onLine === false)
const setOffline = () => { offline.value = true }
const setOnline = () => { offline.value = false }

function retry() {
  location.reload()
}

onMounted(() => {
  window.addEventListener('offline', setOffline)
  window.addEventListener('online', setOnline)
})
onBeforeUnmount(() => {
  window.removeEventListener('offline', setOffline)
  window.removeEventListener('online', setOnline)
})
</script>

<style scoped>
.offline-bar {
  position: fixed; left: 50%; top: calc(12px + env(safe-area-inset-top)); transform: translateX(-50%); z-index: 3000;
  display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-radius: 999px; font-size: 14px;
  background: var(--card-bg); color: var(--text-0); border: 1px solid var(--card-border);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--text-0) 18%, transparent);
}
.offline-bar svg { color: var(--danger); }
.offline-retry {
  border: 0; border-radius: 999px; padding: 4px 12px; font: inherit; font-size: 13px; cursor: pointer;
  color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.offline-bar-enter-active, .offline-bar-leave-active { transition: opacity .2s; }
.offline-bar-enter-from, .offline-bar-leave-to { opacity: 0; }
</style>
