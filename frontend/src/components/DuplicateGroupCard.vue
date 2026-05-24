<template>
  <el-card class="dup-card" :class="{ rejected: decision === 'rejected', accepted: decision === 'accepted' }">
    <div class="card-header">
      <div class="title">
        <el-tag :type="hasHard ? 'danger' : 'warning'" size="small">
          {{ hasHard ? '硬重复（指纹相同）' : 'AI 判定' }}
        </el-tag>
        <span class="member-count">{{ members.length }} 本</span>
        <el-tag v-if="decision === 'accepted'" type="success" size="small">已确认重复</el-tag>
        <el-tag v-if="decision === 'rejected'" type="info" size="small">已标非重复</el-tag>
      </div>
      <div v-if="!readOnly" class="actions">
        <el-button
          size="small"
          type="danger"
          :plain="decision !== 'accepted'"
          @click="$emit('accept')"
        >
          ✓ 删除重复书籍
        </el-button>
        <el-button
          size="small"
          type="primary"
          :plain="decision !== 'rejected'"
          @click="$emit('reject')"
        >
          ✗ 非重复，加入书库
        </el-button>
      </div>
    </div>

    <div class="hint">
      <span v-if="decision === 'accepted'">应用时：保留正本（蓝色高亮的一本），其他成员标为 duplicate</span>
      <span v-else-if="decision === 'rejected'">应用时：所有成员都作为独立书籍单独入库</span>
      <span v-else>未审视——应用时按 AI 判定执行（默认接受为重复）</span>
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
          :disabled="readOnly || decision === 'rejected'"
          @change="onSetCanonical(m.file_path)"
        >
          <span class="path" :title="m.file_path">{{ shortPath(m.file_path) }}</span>
          <span v-if="m.file_path === canonicalPath" class="canonical-label">（正本）</span>
        </el-radio>
        <div class="member-actions">
          <BatchItemPreview :batch-id="batchId" :file-path="m.file_path" />
          <el-button
            v-if="!readOnly && m.file_path !== canonicalPath && decision !== 'rejected'"
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
import type { DuplicateGroupPayload } from '@/types'

const props = withDefaults(defineProps<{
  batchId: string
  payload: DuplicateGroupPayload
  decision?: 'accepted' | 'rejected' | null
  readOnly?: boolean
}>(), { decision: null, readOnly: false })

const emit = defineEmits<{
  modify: [DuplicateGroupPayload]
  accept: []
  reject: []
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
.dup-card.rejected { border-left: 3px solid var(--el-color-info); opacity: 0.85; }
.dup-card.accepted { border-left: 3px solid var(--el-color-danger); }
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
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  border-radius: 4px;
}
.member-row.canonical { background: var(--el-color-success-light-9); }
.member-row.rejected .path { text-decoration: line-through; color: var(--text-3); }
.canonical-label { color: var(--el-color-success); font-size: 12px; margin-left: 6px; }
.path { font-family: monospace; font-size: 13px; }
.member-actions { display: flex; gap: 8px; }
</style>
