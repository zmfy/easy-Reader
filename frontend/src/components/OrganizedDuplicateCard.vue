<template>
  <el-card class="org-card">
    <div class="card-header">
      <div class="title">
        <el-tag type="primary" size="small">AI 整理目录</el-tag>
        <span class="book-title">{{ payload.original.title }}</span>
      </div>
      <router-link
        v-if="!readOnly"
        class="preview-link"
        :to="`/reader/${payload.organized.book_id}`"
        target="_blank"
      >
        <IconEye :size="15" :stroke-width="1.75" />预览整理版
      </router-link>
    </div>

    <div class="meta">
      <span>发起人 {{ payload.requested_by.username }}</span>
      <span>章节 {{ payload.original.chapter_count }} → {{ payload.organized.chapter_count }}</span>
      <span>AI 调用 {{ payload.batches }} 批</span>
      <span>候选行 {{ payload.candidate_count }}</span>
    </div>

    <div v-if="payload.notes.length > 0" class="note notes">
      <div class="notes-title">整理说明</div>
      <ul>
        <li v-for="(n, i) in payload.notes" :key="i">{{ n }}</li>
      </ul>
    </div>

    <div class="toc-bar">
      <span class="toc-counts">
        <template v-if="changedCount === 0">两份目录一致</template>
        <template v-else>
          <span v-for="k in CHANGE_KINDS" v-show="counts[k] > 0" :key="k" class="count" :class="k">{{ KIND_LABELS[k] }} {{ counts[k] }}</span>
        </template>
      </span>
      <el-checkbox v-model="onlyChanged" size="small">只看有变化的</el-checkbox>
    </div>
    <div class="toc-diff">
      <div class="toc-row toc-row--head">
        <span>原目录（{{ payload.original.toc.length }}）</span>
        <span>整理版（{{ payload.organized.toc.length }}）</span>
      </div>
      <div v-if="visibleRows.length === 0" class="toc-empty">没有变化</div>
      <div v-for="(r, i) in visibleRows" :key="i" class="toc-row" :class="r.kind">
        <span class="cell" :style="indent(r)">{{ r.original ?? '—' }}</span>
        <span class="cell" :style="indent(r)">
          <span v-if="r.kind !== 'same'" class="kind">{{ KIND_LABELS[r.kind] }}</span>{{ r.organized ?? '—' }}
        </span>
      </div>
    </div>

    <div class="decision">
      <div class="decision-title">审核决定</div>
      <el-radio-group :model-value="decision" :disabled="readOnly" class="decision-options" @change="onChange">
        <el-radio v-for="(label, key) in ORGANIZE_DECISION_LABELS" :key="key" :value="key">{{ label }}</el-radio>
      </el-radio-group>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { IconEye } from '@tabler/icons-vue'
import { diffToc, type TocDiffKind, type TocDiffRow } from '@/utils/toc-diff'
import { ORGANIZE_DECISION_LABELS } from '@/utils/scan-review'
import type { OrganizeDecision, OrganizedDuplicatePayload } from '@/types'

const props = withDefaults(defineProps<{
  payload: OrganizedDuplicatePayload
  decision: OrganizeDecision
  readOnly?: boolean
}>(), { readOnly: false })

const emit = defineEmits<{ change: [OrganizeDecision] }>()

const KIND_LABELS: Record<TocDiffKind, string> = { same: '相同', renamed: '改名', merged: '合并', removed: '去掉', added: '新增' }
const CHANGE_KINDS: TocDiffKind[] = ['merged', 'removed', 'renamed', 'added']

const rows = computed(() => diffToc(props.payload.original.toc, props.payload.organized.toc))
const counts = computed(() => {
  const c: Record<TocDiffKind, number> = { same: 0, renamed: 0, merged: 0, removed: 0, added: 0 }
  for (const r of rows.value) c[r.kind]++
  return c
})
const changedCount = computed(() => rows.value.length - counts.value.same)
const onlyChanged = ref(true)
const visibleRows = computed(() => onlyChanged.value ? rows.value.filter(r => r.kind !== 'same') : rows.value)

// 层级缩进（level 从 0 或 1 开始都按相对值缩进，最多 3 层）
const minLevel = computed(() => Math.min(...rows.value.map(r => r.level), 0))
function indent(r: TocDiffRow) {
  const depth = Math.min(Math.max(r.level - minLevel.value - 1, 0), 3)
  return depth ? { paddingLeft: `${depth * 12}px` } : undefined
}

function onChange(v: string | number | boolean | undefined): void {
  if (typeof v === 'string' && v in ORGANIZE_DECISION_LABELS) emit('change', v as OrganizeDecision)
}
</script>

<style scoped>
.org-card { margin-bottom: 12px; }
.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.book-title { font-weight: 600; color: var(--text-0); overflow-wrap: anywhere; }
.preview-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--accent);
  text-decoration: none;
}
.preview-link:hover { text-decoration: underline; }
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 12px;
}
.notes { margin-bottom: 12px; }
.notes-title { font-weight: 500; margin-bottom: 4px; }
.notes ul { margin: 0; padding-left: 18px; }

.toc-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.toc-counts { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; color: var(--text-2); }
.count.merged, .toc-row.merged .kind { color: var(--accent); }
.count.removed, .toc-row.removed .kind { color: var(--danger); }
.count.renamed, .toc-row.renamed .kind { color: var(--warning); }
.count.added, .toc-row.added .kind { color: var(--success); }

.toc-diff {
  max-height: 420px;
  overflow: auto;
  border: 1px solid var(--card-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}
.toc-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding: 5px 10px;
  border-bottom: 1px solid var(--card-border);
}
.toc-row:last-child { border-bottom: none; }
.toc-row--head {
  position: sticky;
  top: 0;
  background: var(--card-bg);
  font-weight: 500;
  color: var(--text-1);
}
.toc-row.merged { background: color-mix(in srgb, var(--accent) 6%, var(--card-bg)); }
.toc-row.removed { background: color-mix(in srgb, var(--danger) 6%, var(--card-bg)); }
.toc-row.renamed { background: color-mix(in srgb, var(--warning) 6%, var(--card-bg)); }
.toc-row.added { background: color-mix(in srgb, var(--success) 6%, var(--card-bg)); }
.toc-row.removed .cell:first-child { text-decoration: line-through; color: var(--text-2); }
.cell { overflow-wrap: anywhere; }
.kind { font-size: 12px; margin-right: 6px; }
.toc-empty { padding: 16px; text-align: center; color: var(--text-2); }

.decision { margin-top: 16px; }
.decision-title { font-weight: 500; margin-bottom: 6px; }
.decision-options { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
/* 长选项在窄屏换行 */
.decision-options :deep(.el-radio) { height: auto; min-height: 30px; white-space: normal; margin-right: 0; }
.decision-options :deep(.el-radio__label) { line-height: 1.5; }
</style>
