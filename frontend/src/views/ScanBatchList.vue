<template>
  <DefaultLayout>
    <div class="batch-list-page">
      <div class="page-header">
        <h1>扫描批次</h1>
      </div>

      <el-table v-loading="loading" :data="batches" empty-text="暂无批次">
        <el-table-column prop="id" label="批次 ID" width="280">
          <template #default="{ row }">
            <code>{{ row.id.slice(0, 8) }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="统计">
          <template #default="{ row }">
            <span v-if="row.summary_counts" class="summary">
              新增 {{ summary(row.summary_counts).new }}，
              重复组 {{ summary(row.summary_counts).duplicate_groups }}，
              系列 {{ summary(row.summary_counts).series }}，
              乱码 {{ summary(row.summary_counts).garbled }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160" />
        <el-table-column label="操作" width="180">
          <template #default="{ row }">
            <el-button size="small" type="primary" link @click="goReview(row.id)">
              {{ row.status === 'pending' ? '审核' : '查看' }}
            </el-button>
            <el-button v-if="row.status === 'pending'" size="small" type="danger" link @click="onDiscard(row.id)">
              废弃
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import type { ScanBatch } from '@/types'

const router = useRouter()
const batches = ref<ScanBatch[]>([])
const loading = ref(false)

async function fetchBatches(): Promise<void> {
  loading.value = true
  try {
    const resp = await scanBatchesApi.list()
    batches.value = resp.data.data!
  } finally {
    loading.value = false
  }
}

function statusType(s: string): string {
  return s === 'pending' ? 'warning' : s === 'applied' ? 'success' : 'info'
}
function statusLabel(s: string): string {
  return ({ pending: '待审核', applied: '已应用', discarded: '已废弃' } as Record<string, string>)[s] ?? s
}
function summary(s: string): Record<string, number> {
  try { return JSON.parse(s) } catch { return {} }
}

function goReview(id: string): void {
  router.push(`/library/scan-batches/${id}`)
}

async function onDiscard(id: string): Promise<void> {
  await ElMessageBox.confirm('废弃此批次将丢失 AI 判定结果，确定？', '确认', { type: 'warning' })
  await scanBatchesApi.discard(id)
  ElMessage.success('已废弃')
  await fetchBatches()
}

onMounted(fetchBatches)
</script>

<style scoped>
.batch-list-page { padding: 32px; }
.page-header { margin-bottom: 24px; }
.summary { font-size: 13px; color: var(--text-2); }
</style>
