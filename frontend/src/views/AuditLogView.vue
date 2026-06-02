<template>
  <DefaultLayout>
    <div class="audit-page">
      <div class="page-header">
        <el-button link @click="$router.push('/library')">← 返回书库</el-button>
        <h1>审计日志</h1>
        <div class="subtitle">admin 对书库的删除 / 应用 / 修正等操作记录</div>
      </div>

      <el-table v-loading="loading" :data="logs" empty-text="暂无日志">
        <el-table-column prop="created_at" label="时间" width="180" />
        <el-table-column prop="action" label="操作" width="180">
          <template #default="{ row }">
            <el-tag :type="actionTagType(row.action)">{{ actionLabel(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="user_id" label="用户" width="120">
          <template #default="{ row }"><code class="id-short">{{ row.user_id.slice(0,8) }}</code></template>
        </el-table-column>
        <el-table-column prop="file_path" label="文件路径" show-overflow-tooltip>
          <template #default="{ row }">
            <code v-if="row.file_path" class="path">{{ row.file_path }}</code>
            <span v-else class="empty">-</span>
          </template>
        </el-table-column>
        <el-table-column label="详情" width="100">
          <template #default="{ row }">
            <el-popover v-if="row.details" trigger="click" :width="400">
              <template #reference>
                <el-button size="small" link>查看</el-button>
              </template>
              <pre>{{ formatDetails(row.details) }}</pre>
            </el-popover>
            <span v-else class="empty">-</span>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="total > pageSize" class="pagination">
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next, ->, total"
          background
          @current-change="fetchLogs"
        />
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { auditLogApi } from '@/api/audit-log'
import type { AuditLog } from '@/types'

const logs = ref<AuditLog[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 50
const loading = ref(false)

async function fetchLogs(): Promise<void> {
  loading.value = true
  try {
    const resp = await auditLogApi.list({ limit: pageSize, offset: (page.value - 1) * pageSize })
    logs.value = resp.data.data?.logs ?? []
    total.value = resp.data.data?.total ?? 0
  } finally {
    loading.value = false
  }
}

function actionLabel(a: string): string {
  const map: Record<string, string> = {
    delete_book_file: '删除文件',
    delete_book_record: '删除书籍记录',
    apply_batch: '应用批次',
    discard_batch: '废弃批次',
    create_manual_override: '新建人工修正',
    delete_manual_override: '删除人工修正',
  }
  return map[a] ?? a
}

function actionTagType(a: string): 'danger' | 'success' | 'info' | 'primary' {
  if (a.startsWith('delete')) return 'danger'
  if (a === 'apply_batch') return 'success'
  if (a === 'discard_batch') return 'info'
  return 'primary'
}

function formatDetails(d: string): string {
  try { return JSON.stringify(JSON.parse(d), null, 2) } catch { return d }
}

onMounted(fetchLogs)
</script>

<style scoped>
.audit-page { padding: 24px 32px; }
.page-header { margin-bottom: 16px; }
.page-header h1 { margin: 8px 0 4px 0; }
.subtitle { font-size: 13px; color: var(--text-2); }
.pagination { margin-top: 24px; display: flex; justify-content: center; }
.id-short { font-family: monospace; font-size: 12px; }
.path { font-family: monospace; font-size: 12px; word-break: break-all; }
.empty { color: var(--text-3); }
pre { white-space: pre-wrap; font-size: 12px; margin: 0; }
</style>
