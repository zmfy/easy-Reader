<template>
  <transition name="pwa-bar">
    <div v-if="needRefresh" class="pwa-bar" role="status">
      <IconRefresh :size="16" :stroke-width="1.75" />
      <button type="button" class="pwa-bar-btn" @click="updateServiceWorker(true)">有新版本，点击刷新</button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { useRegisterSW } from 'virtual:pwa-register/vue'
import { IconRefresh } from '@tabler/icons-vue'

// 新版本就绪时不自动刷新（避免打断阅读），由用户点击后切换
const { needRefresh, updateServiceWorker } = useRegisterSW({ immediate: true })
</script>

<style scoped>
.pwa-bar {
  position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 3000;
  display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px;
  background: var(--card-bg); color: var(--accent); border: 1px solid var(--card-border);
  box-shadow: 0 6px 24px color-mix(in srgb, var(--text-0) 18%, transparent);
}
.pwa-bar-btn { border: 0; background: none; padding: 0; font: inherit; font-size: 14px; color: inherit; cursor: pointer; }
.pwa-bar-enter-active, .pwa-bar-leave-active { transition: opacity .2s, transform .2s; }
.pwa-bar-enter-from, .pwa-bar-leave-to { opacity: 0; transform: translate(-50%, 8px); }
</style>
