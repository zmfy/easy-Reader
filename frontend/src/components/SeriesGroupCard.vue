<template>
  <el-card class="series-card" :class="{ rejected: decision === 'rejected', accepted: decision === 'accepted' }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="payload.source === 'ai' ? 'warning' : 'primary'" size="small">
          {{ payload.source === 'ai' ? `AI 判定 (${payload.confidence})` : '正则匹配' }}
        </el-tag>
        <el-input
          v-model="seriesName"
          size="small"
          style="width: 180px"
          :disabled="readOnly || decision === 'rejected'"
          @blur="emitModified"
        />
        <span class="member-count">{{ activeMembers.length }} 本</span>
        <el-tag v-if="decision === 'accepted'" type="success" size="small">已确认归纳</el-tag>
        <el-tag v-if="decision === 'rejected'" type="info" size="small">已标单独入库</el-tag>
      </div>
      <div v-if="!readOnly" class="actions">
        <el-button
          size="small"
          type="primary"
          :plain="decision !== 'accepted'"
          @click="$emit('accept')"
        >
          ✓ 归纳为一组
        </el-button>
        <el-button
          size="small"
          :plain="decision !== 'rejected'"
          @click="$emit('reject')"
        >
          ✗ 单独入库
        </el-button>
      </div>
    </div>

    <div class="hint">
      <span v-if="decision === 'accepted'">应用时：创建系列并将成员归入</span>
      <span v-else-if="decision === 'rejected'">应用时：每本单独作为独立书籍入库，不创建系列</span>
      <span v-else>未审视——应用时按 AI 判定执行（默认接受归纳）</span>
    </div>

    <div class="members">
      <div
        v-for="m in payload.members"
        :key="m.file_path"
        class="member-row"
        :class="{ rejected: rejectedSet.has(m.file_path) }"
      >
        <span class="seq">#{{ m.sequence }}</span>
        <span class="path" :title="m.file_path">{{ shortPath(m.file_path) }}</span>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button
            v-if="!readOnly && decision !== 'rejected'"
            size="small"
            link
            type="warning"
            @click="onToggleReject(m.file_path)"
          >
            {{ rejectedSet.has(m.file_path) ? '撤回剔除' : '此本剔除' }}
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

const props = withDefaults(defineProps<{
  batchId: string
  payload: SeriesGroupPayload
  decision?: 'accepted' | 'rejected' | null
  readOnly?: boolean
}>(), { decision: null, readOnly: false })

const emit = defineEmits<{
  modify: [SeriesGroupPayload]
  accept: []
  reject: []
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
.series-card.rejected { border-left: 3px solid var(--el-color-info); opacity: 0.85; }
.series-card.accepted { border-left: 3px solid var(--el-color-primary); }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}
.title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.member-count { color: var(--text-2); font-size: 13px; }
.actions { display: flex; gap: 8px; }
.hint {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 12px;
  padding: 6px 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
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
