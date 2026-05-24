<template>
  <DefaultLayout>
    <div v-loading="loading" class="review-page">
      <div class="page-header">
        <div>
          <el-button link @click="$router.push('/library/scan-batches')">← 返回批次列表</el-button>
          <h1>
            {{ readOnly ? '查看批次' : '审核批次' }} {{ batchIdShort }}
            <el-tag v-if="batch" :type="statusType" size="small">{{ statusLabel }}</el-tag>
          </h1>
        </div>
        <div class="actions">
          <div v-if="!readOnly && unreviewedCount > 0" class="unreviewed-stats">
            <el-tag type="warning">{{ unreviewedCount }} 项未审视</el-tag>
          </div>
          <el-button v-if="!readOnly" type="danger" plain @click="onDiscard">废弃批次</el-button>
          <el-button
            v-if="!readOnly"
            type="primary"
            :disabled="batch?.status !== 'pending'"
            @click="onApply"
          >应用全部</el-button>
        </div>
      </div>

      <!-- Applied/discarded: show audit summary at top -->
      <el-alert
        v-if="readOnly && appliedSummary"
        type="success"
        :closable="false"
        show-icon
        class="audit-alert"
      >
        <template #title>
          应用结果 · {{ batch?.applied_at }} by {{ batch?.applied_by }}
        </template>
        <div class="audit-summary">
          新增 {{ appliedSummary.inserted }} ·
          更新 {{ appliedSummary.updated }} ·
          关联重复 {{ appliedSummary.duplicates_linked }} ·
          创建系列 {{ appliedSummary.series_created }} ·
          标乱码 {{ appliedSummary.garbled_marked }}
          <span v-if="appliedSummary.errors.length > 0" class="errors">
            · <strong>错误 {{ appliedSummary.errors.length }}</strong>
          </span>
        </div>
      </el-alert>

      <el-collapse v-if="batch" v-model="activePanels">
        <el-collapse-item v-if="grouped.new.length > 0" :name="'new'">
          <template #title>
            <span class="panel-title">新书 <el-badge :value="grouped.new.length" /></span>
          </template>
          <div v-if="activePanels.includes('new')" class="panel-body">
            <div v-for="item in paged('new')" :key="item.id" class="new-row">
              <span class="path" :title="payload(item).file_path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="meta">{{ payload(item).chapter_count }} 章</span>
              <BatchItemPreview :batch-id="batch.id" :file-path="payload(item).file_path" />
            </div>
            <el-pagination
              v-if="grouped.new.length > PAGE_SIZE"
              v-model:current-page="pages.new"
              :page-size="PAGE_SIZE"
              :total="grouped.new.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.duplicate_group.length > 0" :name="'duplicate_group'">
          <template #title>
            <span class="panel-title">重复组 <el-badge :value="grouped.duplicate_group.length" /></span>
          </template>
          <div v-if="activePanels.includes('duplicate_group')" class="panel-body">
            <DuplicateGroupCard
              v-for="item in paged('duplicate_group')"
              :key="item.id"
              :batch-id="batch.id"
              :payload="payload(item)"
              :decision="decisionOf(item)"
              :read-only="readOnly"
              @modify="(p) => onModify(item.id, p)"
              @accept="onItemAccept(item.id)"
              @reject="onItemReject(item.id)"
            />
            <el-pagination
              v-if="grouped.duplicate_group.length > PAGE_SIZE"
              v-model:current-page="pages.duplicate_group"
              :page-size="PAGE_SIZE"
              :total="grouped.duplicate_group.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.series.length > 0" :name="'series'">
          <template #title>
            <span class="panel-title">系列 <el-badge :value="grouped.series.length" /></span>
          </template>
          <div v-if="activePanels.includes('series')" class="panel-body">
            <SeriesGroupCard
              v-for="item in paged('series')"
              :key="item.id"
              :batch-id="batch.id"
              :payload="payload(item)"
              :decision="decisionOf(item)"
              :read-only="readOnly"
              @modify="(p) => onModify(item.id, p)"
              @accept="onItemAccept(item.id)"
              @reject="onItemReject(item.id)"
            />
            <el-pagination
              v-if="grouped.series.length > PAGE_SIZE"
              v-model:current-page="pages.series"
              :page-size="PAGE_SIZE"
              :total="grouped.series.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.encoding_fixed.length > 0" :name="'encoding_fixed'">
          <template #title>
            <span class="panel-title">编码已修复 <el-badge :value="grouped.encoding_fixed.length" /></span>
          </template>
          <div v-if="activePanels.includes('encoding_fixed')" class="panel-body">
            <div v-for="item in paged('encoding_fixed')" :key="item.id" class="fix-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <el-tag size="small">{{ payload(item).from_encoding }} → utf-8</el-tag>
            </div>
            <el-pagination
              v-if="grouped.encoding_fixed.length > PAGE_SIZE"
              v-model:current-page="pages.encoding_fixed"
              :page-size="PAGE_SIZE"
              :total="grouped.encoding_fixed.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.garbled.length > 0" :name="'garbled'">
          <template #title>
            <span class="panel-title">真乱码（保留磁盘，不入书库） <el-badge :value="grouped.garbled.length" type="danger" /></span>
          </template>
          <div v-if="activePanels.includes('garbled')" class="panel-body">
            <div v-for="item in paged('garbled')" :key="item.id" class="garbled-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="reason">{{ payload(item).reason }}</span>
            </div>
            <el-pagination
              v-if="grouped.garbled.length > PAGE_SIZE"
              v-model:current-page="pages.garbled"
              :page-size="PAGE_SIZE"
              :total="grouped.garbled.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import DuplicateGroupCard from '@/components/DuplicateGroupCard.vue'
import SeriesGroupCard from '@/components/SeriesGroupCard.vue'
import BatchItemPreview from '@/components/BatchItemPreview.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanBatch, ScanBatchItem } from '@/types'

const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const batchId = route.params.id as string
const batchIdShort = computed(() => batchId.slice(0, 8))

const batch = ref<ScanBatch | null>(null)
const items = ref<ScanBatchItem[]>([])
const loading = ref(false)
// Default: all collapsed for performance; user must click to expand
const activePanels = ref<string[]>([])
const pages = reactive<Record<string, number>>({
  new: 1, duplicate_group: 1, series: 1, garbled: 1, encoding_fixed: 1,
})

const readOnly = computed(() => batch.value?.status !== 'pending')

const statusType = computed(() => {
  const s = batch.value?.status
  return s === 'pending' ? 'warning' : s === 'applied' ? 'success' : 'info'
})
const statusLabel = computed(() => {
  const map: Record<string, string> = { pending: '待审核', applied: '已应用', discarded: '已废弃' }
  return map[batch.value?.status ?? ''] ?? batch.value?.status ?? ''
})

interface ApplySummary {
  inserted: number
  updated: number
  duplicates_linked: number
  series_created: number
  garbled_marked: number
  errors: Array<{ item_id: string; message: string }>
}
const appliedSummary = computed<ApplySummary | null>(() => {
  if (!batch.value?.apply_summary) return null
  try { return JSON.parse(batch.value.apply_summary) as ApplySummary } catch { return null }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(item: ScanBatchItem): any {
  try { return JSON.parse(item.admin_payload ?? item.payload) } catch { return {} }
}
function shortPath(p: string): string { return (p || '').split('/').slice(-2).join('/') }

function decisionOf(item: ScanBatchItem): 'accepted' | 'rejected' | null {
  if (item.admin_decision === 'reject') return 'rejected'
  if (item.admin_decision === 'accept' || item.admin_decision === 'modified') return 'accepted'
  return null
}

const grouped = computed(() => {
  const out: Record<string, ScanBatchItem[]> = {
    new: [], duplicate_group: [], series: [], garbled: [], encoding_fixed: [],
  }
  for (const it of items.value) {
    if (it.type in out) out[it.type].push(it)
  }
  return out as {
    new: ScanBatchItem[]
    duplicate_group: ScanBatchItem[]
    series: ScanBatchItem[]
    garbled: ScanBatchItem[]
    encoding_fixed: ScanBatchItem[]
  }
})

function paged(type: 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed'): ScanBatchItem[] {
  const all = grouped.value[type]
  const start = (pages[type] - 1) * PAGE_SIZE
  return all.slice(start, start + PAGE_SIZE)
}

const unreviewedCount = computed(() => items.value.filter(i => !i.admin_decision).length)

async function fetchBatch(): Promise<void> {
  loading.value = true
  try {
    const resp = await scanBatchesApi.get(batchId)
    batch.value = resp.data.data!.batch
    items.value = resp.data.data!.items
  } finally {
    loading.value = false
  }
}

async function onModify(itemId: string, p: unknown): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'modified', p)
  await fetchBatch()
}
async function onItemAccept(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'accept')
  await fetchBatch()
}
async function onItemReject(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'reject')
  await fetchBatch()
}
async function onApply(): Promise<void> {
  await ElMessageBox.confirm(
    `确认应用？\n${unreviewedCount.value} 项未审视将按 AI 判定执行（重复=合并、系列=归纳）。`,
    '应用确认',
    { type: 'warning' },
  )
  const resp = await scanBatchesApi.apply(batchId)
  const r = resp.data.data!
  ElMessage({
    type: r.errors.length > 0 ? 'warning' : 'success',
    message: `已应用：新增 ${r.inserted} · 更新 ${r.updated} · 关联重复 ${r.duplicates_linked} · 创建系列 ${r.series_created} · 标乱码 ${r.garbled_marked}${r.errors.length > 0 ? ` · 错误 ${r.errors.length}` : ''}`,
    duration: 6000,
  })
  await fetchBatch() // stay on page, now in read-only mode showing audit
}
async function onDiscard(): Promise<void> {
  await ElMessageBox.confirm('确认废弃整个批次？AI 判定结果将丢弃，但已修复编码的文件不会还原。', '废弃确认', { type: 'warning' })
  await scanBatchesApi.discard(batchId)
  ElMessage.success('已废弃')
  router.push('/library/scan-batches')
}

onMounted(fetchBatch)
</script>

<style scoped>
.review-page { padding: 24px 32px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}
.page-header h1 { margin: 8px 0 0 0; display: flex; align-items: center; gap: 10px; }
.actions { display: flex; gap: 12px; align-items: center; }
.unreviewed-stats { margin-right: 8px; }
.audit-alert { margin-bottom: 16px; }
.audit-summary { font-size: 13px; }
.audit-summary .errors { color: var(--el-color-danger); }
.panel-title { font-weight: 500; }
.panel-body { padding: 8px 0; }
.new-row, .fix-row, .garbled-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}
.path { font-family: monospace; }
.meta { color: var(--text-2); }
.reason { color: var(--el-color-danger); font-size: 12px; }
</style>
