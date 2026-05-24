<template>
  <el-card class="series-card" :class="{ rejected: isRejected }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="payload.source === 'ai' ? 'warning' : 'primary'" size="small">
          {{ payload.source === 'ai' ? `AI 判定 (${payload.confidence})` : '正则匹配' }}
        </el-tag>
        <el-input
          v-model="seriesName"
          size="small"
          style="width: 180px"
          @blur="emitModified"
        />
        <span class="member-count">{{ activeMembers.length }} 本</span>
      </div>
      <div class="actions">
        <el-button v-if="!isRejected" size="small" type="danger" plain @click="$emit('reject')">
          否决整组
        </el-button>
        <el-button v-else size="small" @click="$emit('restore')">恢复</el-button>
      </div>
    </div>

    <div class="members">
      <div
        v-for="m in payload.members"
        :key="m.file_path"
        class="member-row"
        :class="{ rejected: rejectedSet.has(m.file_path) }"
      >
        <span class="seq">#{{ m.sequence }}</span>
        <span class="path">{{ shortPath(m.file_path) }}</span>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button size="small" link type="warning" @click="onToggleReject(m.file_path)">
            {{ rejectedSet.has(m.file_path) ? '撤回' : '剔除' }}
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BatchItemPreview from './BatchItemPreview.vue'
import type { SeriesGroupPayload } from '@/types'

const props = defineProps<{
  batchId: string
  payload: SeriesGroupPayload
  isRejected: boolean
}>()

const emit = defineEmits<{
  modify: [SeriesGroupPayload]
  reject: []
  restore: []
}>()

const seriesName = ref(props.payload.series_name)
const rejectedSet = ref(new Set<string>())

const activeMembers = computed(() => props.payload.members.filter(m => !rejectedSet.value.has(m.file_path)))

function shortPath(p: string): string { return p.split('/').slice(-2).join('/') }

function onToggleReject(p: string): void {
  if (rejectedSet.value.has(p)) rejectedSet.value.delete(p)
  else rejectedSet.value.add(p)
  emitModified()
}

function emitModified(): void {
  emit('modify', {
    series_name: seriesName.value,
    author: props.payload.author,
    members: activeMembers.value,
    source: props.payload.source,
    confidence: props.payload.confidence,
    rejected_members: [...rejectedSet.value],
  })
}
</script>

<style scoped>
.series-card { margin-bottom: 12px; }
.series-card.rejected { opacity: 0.5; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.title { display: flex; align-items: center; gap: 8px; }
.member-count { color: var(--text-2); font-size: 13px; }
.members { display: flex; flex-direction: column; gap: 6px; }
.member-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 8px;
}
.member-row.rejected .path { text-decoration: line-through; }
.seq { font-family: monospace; color: var(--el-color-primary); }
.path { flex: 1; font-family: monospace; font-size: 13px; }
.member-actions { display: flex; gap: 8px; }
</style>
