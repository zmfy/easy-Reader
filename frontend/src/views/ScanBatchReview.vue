<template>
  <DefaultLayout>
    <div v-loading="loading" class="review-page">
      <div class="page-header">
        <div>
          <el-button link @click="$router.push('/library/scan-batches')">← 返回批次列表</el-button>
          <h1>审核批次 {{ batchIdShort }}</h1>
        </div>
        <div class="actions">
          <div v-if="unreviewedCount > 0" class="unreviewed-stats">
            <el-tag type="warning">{{ unreviewedCount }} 项未审视</el-tag>
          </div>
          <el-button type="danger" plain @click="onDiscard">废弃批次</el-button>
          <el-button type="primary" :disabled="batch?.status !== 'pending'" @click="onApply">
            应用全部
          </el-button>
        </div>
      </div>

      <el-collapse v-if="batch" v-model="activePanels">
        <el-collapse-item v-if="grouped.new.length > 0" :name="'new'">
          <template #title>
            <span class="panel-title">新书 <el-badge :value="grouped.new.length" /></span>
          </template>
          <div class="new-list">
            <div v-for="item in grouped.new" :key="item.id" class="new-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="meta">{{ payload(item).chapter_count }} 章</span>
              <BatchItemPreview :batch-id="batch.id" :file-path="payload(item).file_path" />
            </div>
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.duplicate_group.length > 0" :name="'duplicate_group'">
          <template #title>
            <span class="panel-title">重复组 <el-badge :value="grouped.duplicate_group.length" /></span>
          </template>
          <DuplicateGroupCard
            v-for="item in grouped.duplicate_group"
            :key="item.id"
            :batch-id="batch.id"
            :payload="payload(item)"
            :is-rejected="item.admin_decision === 'reject'"
            @modify="(p) => onModify(item.id, p)"
            @reject="onItemReject(item.id)"
            @restore="onItemRestore(item.id)"
          />
        </el-collapse-item>

        <el-collapse-item v-if="grouped.series.length > 0" :name="'series'">
          <template #title>
            <span class="panel-title">系列 <el-badge :value="grouped.series.length" /></span>
          </template>
          <SeriesGroupCard
            v-for="item in grouped.series"
            :key="item.id"
            :batch-id="batch.id"
            :payload="payload(item)"
            :is-rejected="item.admin_decision === 'reject'"
            @modify="(p) => onModify(item.id, p)"
            @reject="onItemReject(item.id)"
            @restore="onItemRestore(item.id)"
          />
        </el-collapse-item>

        <el-collapse-item v-if="grouped.encoding_fixed.length > 0" :name="'encoding_fixed'">
          <template #title>
            <span class="panel-title">编码已修复 <el-badge :value="grouped.encoding_fixed.length" /></span>
          </template>
          <div v-for="item in grouped.encoding_fixed" :key="item.id" class="fix-row">
            <span class="path">{{ shortPath(payload(item).file_path) }}</span>
            <el-tag size="small">{{ payload(item).from_encoding }} → utf-8</el-tag>
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.garbled.length > 0" :name="'garbled'">
          <template #title>
            <span class="panel-title">真乱码 <el-badge :value="grouped.garbled.length" type="danger" /></span>
          </template>
          <div v-for="item in grouped.garbled" :key="item.id" class="garbled-row">
            <span class="path">{{ shortPath(payload(item).file_path) }}</span>
            <span class="reason">{{ payload(item).reason }}</span>
          </div>
        </el-collapse-item>
      </el-collapse>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import DuplicateGroupCard from '@/components/DuplicateGroupCard.vue'
import SeriesGroupCard from '@/components/SeriesGroupCard.vue'
import BatchItemPreview from '@/components/BatchItemPreview.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanBatch, ScanBatchItem } from '@/types'

const route = useRoute()
const router = useRouter()
const batchId = route.params.id as string
const batchIdShort = computed(() => batchId.slice(0, 8))

const batch = ref<ScanBatch | null>(null)
const items = ref<ScanBatchItem[]>([])
const loading = ref(false)
const activePanels = ref(['new', 'duplicate_group', 'series', 'encoding_fixed', 'garbled'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(item: ScanBatchItem): any {
  try { return JSON.parse(item.admin_payload ?? item.payload) } catch { return {} }
}
function shortPath(p: string): string { return (p || '').split('/').slice(-2).join('/') }

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
async function onItemReject(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'reject')
  await fetchBatch()
}
async function onItemRestore(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'accept')
  await fetchBatch()
}
async function onApply(): Promise<void> {
  await ElMessageBox.confirm(`确认应用？将影响书库。${unreviewedCount.value} 项未审视将按 AI 判定执行。`, '应用确认', { type: 'warning' })
  const resp = await scanBatchesApi.apply(batchId)
  const r = resp.data.data!
  ElMessage.success(`已应用：新增 ${r.inserted}，更新 ${r.updated}，错误 ${r.errors.length}`)
  router.push('/library')
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
  margin-bottom: 24px;
}
.page-header h1 { margin: 8px 0 0 0; }
.actions { display: flex; gap: 12px; align-items: center; }
.unreviewed-stats { margin-right: 8px; }
.panel-title { font-weight: 500; }
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
