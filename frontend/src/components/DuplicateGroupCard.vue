<template>
  <el-card class="dup-card" :class="{ rejected: isRejected }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="hasHard ? 'danger' : 'warning'" size="small">
          {{ hasHard ? '硬重复（指纹相同）' : 'AI 判定' }}
        </el-tag>
        <span class="member-count">{{ members.length }} 本</span>
      </div>
      <div class="actions">
        <el-button v-if="!isRejected" size="small" type="danger" plain @click="$emit('reject')">
          否决整组
        </el-button>
        <el-button v-else size="small" @click="$emit('restore')">
          恢复
        </el-button>
      </div>
    </div>

    <div class="members">
      <div
        v-for="m in members"
        :key="m.file_path"
        class="member-row"
        :class="{ canonical: m.file_path === canonicalPath, rejected: rejectedSet.has(m.file_path) }"
      >
        <el-radio
          :model-value="canonicalPath"
          :label="m.file_path"
          @change="onSetCanonical(m.file_path)"
        >
          <span class="path">{{ shortPath(m.file_path) }}</span>
        </el-radio>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button
            v-if="m.file_path !== canonicalPath"
            size="small"
            link
            type="warning"
            @click="onToggleReject(m.file_path)"
          >
            {{ rejectedSet.has(m.file_path) ? '撤回' : '剔除（不是重复）' }}
          </el-button>
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import BatchItemPreview from './BatchItemPreview.vue'
import type { DuplicateGroupPayload } from '@/types'

const props = defineProps<{
  batchId: string
  payload: DuplicateGroupPayload
  isRejected: boolean
}>()

const emit = defineEmits<{
  modify: [DuplicateGroupPayload]
  reject: []
  restore: []
}>()

const canonicalPath = ref(props.payload.canonical_file_path)
const rejectedSet = ref(new Set<string>())

const members = computed(() => props.payload.members)
const hasHard = computed(() => members.value.some(m => m.decision_type === 'hard'))

function shortPath(p: string): string {
  return p.split('/').slice(-2).join('/')
}

function onSetCanonical(p: string): void {
  canonicalPath.value = p
  emitModified()
}

function onToggleReject(p: string): void {
  if (rejectedSet.value.has(p)) rejectedSet.value.delete(p)
  else rejectedSet.value.add(p)
  emitModified()
}

function emitModified(): void {
  const rejectedArr = [...rejectedSet.value].map(p => {
    const m = members.value.find(x => x.file_path === p)
    return { file_path: p, fingerprint: m?.fingerprint }
  })
  emit('modify', {
    canonical_file_path: canonicalPath.value,
    members: members.value.filter(m => !rejectedSet.value.has(m.file_path)),
    rejected_members: rejectedArr,
  })
}
</script>

<style scoped>
.dup-card { margin-bottom: 12px; }
.dup-card.rejected { opacity: 0.5; }
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
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
}
.member-row.canonical { background: var(--el-color-success-light-9); }
.member-row.rejected .path { text-decoration: line-through; color: var(--text-3); }
.path { font-family: monospace; font-size: 13px; }
.member-actions { display: flex; gap: 8px; }
</style>
