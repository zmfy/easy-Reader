<template>
  <div class="guide-link">
    <div>
      {{ label }}：<a :href="guideUrl(guide, anchor)" target="_blank" rel="noopener noreferrer">《{{ guide.title }}<span class="guide-link-end">》<IconExternalLink class="guide-link-icon" :size="12" :stroke-width="1.75" /></span></a>
    </div>
    <div class="guide-link-note">{{ SITE_SLOW_NOTE }}</div>
  </div>
</template>

<script setup lang="ts">
import { IconExternalLink } from '@tabler/icons-vue'
import { guideUrl, SITE_SLOW_NOTE, type Guide } from '@/utils/links'

withDefaults(defineProps<{ guide: Guide; anchor?: string; label?: string }>(), {
  anchor: undefined,
  label: '详细设置方法参考',
})
</script>

<style scoped>
.guide-link {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-2);
}
.guide-link a {
  color: var(--accent);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.guide-link a:hover { text-decoration: underline; }
.guide-link-end { white-space: nowrap; }
.guide-link-icon { margin-left: 2px; vertical-align: -1px; }
.guide-link-note { font-size: 11px; opacity: 0.85; }
</style>
