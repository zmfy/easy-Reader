<template>
  <div class="series-card" @click="$emit('click', series)">
    <div class="cover-stack">
      <div class="stack-layer layer-2"></div>
      <div class="stack-layer layer-1"></div>
      <img v-if="series.cover_url" :src="series.cover_url" class="cover" alt="" />
      <div v-else class="cover placeholder">📚</div>
      <el-tag class="series-tag" type="primary" size="small">系列</el-tag>
    </div>
    <div class="info">
      <div class="title" :title="series.name">{{ series.name }}</div>
      <div class="meta">{{ series.member_count ?? 0 }} 本 <span v-if="series.author">· {{ series.author }}</span></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Series } from '@/types'
defineProps<{ series: Series }>()
defineEmits<{ click: [Series] }>()
</script>

<style scoped>
.series-card {
  cursor: pointer;
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.08);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}
.series-card:hover {
  transform: translateY(-5px);
  border-color: rgba(124, 92, 255, 0.3);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(124, 92, 255, 0.12);
}
.cover-stack {
  position: relative;
  aspect-ratio: 3 / 4;
  padding: 10px 14px 4px 4px;
}
.cover, .stack-layer {
  position: absolute;
  inset: 10px 14px 4px 4px;
  border-radius: 8px;
  border: 1px solid rgba(124, 92, 255, 0.15);
}
.cover {
  background: var(--bg-2);
  overflow: hidden;
  object-fit: cover;
  z-index: 3;
}
.cover.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  background: linear-gradient(160deg, rgba(124, 92, 255, 0.25), rgba(0, 212, 184, 0.15));
}
.stack-layer {
  background: var(--bg-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.stack-layer.layer-1 {
  transform: translate(5px, 5px);
  z-index: 2;
  opacity: 0.85;
}
.stack-layer.layer-2 {
  transform: translate(10px, 10px);
  z-index: 1;
  opacity: 0.6;
}
.series-tag {
  position: absolute;
  top: 14px;
  right: 18px;
  z-index: 5;
}
.info { padding: 10px 12px 12px; }
.title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
  line-height: 1.4;
}
.meta {
  font-size: 11px;
  color: var(--text-2);
}
</style>
