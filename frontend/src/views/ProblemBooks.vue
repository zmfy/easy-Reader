<template>
  <DefaultLayout>
    <div class="problem-page">
      <div class="page-header">
        <div>
          <el-button link @click="$router.push('/library')">← 返回书库</el-button>
          <h1>问题书籍管理</h1>
          <div class="subtitle">查看并清理乱码 / 重复书籍。物理删除不可恢复。</div>
        </div>
        <div class="filters">
          <el-radio-group v-model="filter" @change="onFilterChange">
            <el-radio-button value="problems">全部 ({{ totals.problems }})</el-radio-button>
            <el-radio-button value="garbled">乱码 ({{ totals.garbled }})</el-radio-button>
            <el-radio-button value="duplicate">重复 ({{ totals.duplicate }})</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="warn-alert"
      >
        <template #title>注意：物理删除会真的把磁盘上的文件删除，<strong>不可恢复</strong></template>
        删除前请务必确认。仅删除"书库记录"则保留磁盘文件（下次扫描会重新发现）。
      </el-alert>

      <el-table v-loading="loading" :data="books" empty-text="没有问题书籍" class="problem-table">
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'garbled' ? 'danger' : 'warning'" size="small">
              {{ row.status === 'garbled' ? '乱码' : '重复' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="书名" min-width="180" show-overflow-tooltip />
        <el-table-column prop="file_path" label="磁盘路径" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="path">{{ row.file_path }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="file_size" label="大小" width="100">
          <template #default="{ row }">
            {{ formatSize(row.file_size) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="240" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="onRemoveDbOnly(row)">仅删书库记录</el-button>
            <el-button size="small" type="danger" @click="onDeleteWithFile(row)">彻底删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="pagination.totalPages > 1" class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          layout="prev, pager, next, ->, total"
          background
          @current-change="fetchBooks"
        />
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { libraryApi } from '@/api/library'
import type { Book } from '@/types'

const books = ref<Book[]>([])
const loading = ref(false)
const filter = ref<'problems' | 'garbled' | 'duplicate'>('problems')

const totals = reactive({ problems: 0, garbled: 0, duplicate: 0 })

const pagination = reactive({
  page: 1,
  pageSize: 50,
  total: 0,
  totalPages: 0,
})

function formatSize(bytes?: number): string {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function fetchTotals(): Promise<void> {
  // Quick counts via 3 small list calls (could be a dedicated endpoint later)
  try {
    const [p, g, d] = await Promise.all([
      libraryApi.list({ page: 1, pageSize: 1, status: 'problems' }),
      libraryApi.list({ page: 1, pageSize: 1, status: 'garbled' }),
      libraryApi.list({ page: 1, pageSize: 1, status: 'duplicate' }),
    ])
    totals.problems = p.data.pagination.total
    totals.garbled = g.data.pagination.total
    totals.duplicate = d.data.pagination.total
  } catch { /* ignore */ }
}

async function fetchBooks(): Promise<void> {
  loading.value = true
  try {
    const resp = await libraryApi.list({
      page: pagination.page,
      pageSize: pagination.pageSize,
      status: filter.value,
      sortBy: 'imported_at',
      sortOrder: 'desc',
    })
    books.value = resp.data.data
    Object.assign(pagination, resp.data.pagination)
  } finally {
    loading.value = false
  }
}

function onFilterChange(): void {
  pagination.page = 1
  void fetchBooks()
}

async function onRemoveDbOnly(book: Book): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `仅删除书库记录吗？\n\n磁盘文件 ${book.file_path} 不会被删除。\n下次扫描时该文件可能会被重新发现。`,
      '确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }
  await libraryApi.remove(book.id, false)
  ElMessage.success('已从书库移除')
  await Promise.all([fetchBooks(), fetchTotals()])
}

async function onDeleteWithFile(book: Book): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `彻底删除将物理删除磁盘文件！\n\n文件：${book.file_path}\n\n此操作不可恢复！确认继续吗？`,
      '危险操作 — 不可恢复',
      {
        type: 'error',
        confirmButtonText: '确认彻底删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger',
        dangerouslyUseHTMLString: false,
      },
    )
  } catch { return }
  const resp = await libraryApi.remove(book.id, true)
  const data = resp.data.data
  if (data?.fileDeleted) {
    ElMessage.success('已彻底删除（含磁盘文件）')
  } else if (data?.fileError) {
    ElMessage.warning(`数据库记录已删除，但磁盘文件删除失败：${data.fileError}`)
  } else {
    ElMessage.success('已删除')
  }
  await Promise.all([fetchBooks(), fetchTotals()])
}

onMounted(async () => {
  await fetchTotals()
  await fetchBooks()
})
</script>

<style scoped>
.problem-page { padding: 24px 32px; }
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 16px;
  gap: 16px;
  flex-wrap: wrap;
}
.page-header h1 { margin: 8px 0 0 0; }
.subtitle { font-size: 13px; color: var(--text-2); margin-top: 4px; }
.warn-alert { margin-bottom: 16px; }
.problem-table { margin-top: 8px; }
.path { font-family: monospace; font-size: 12px; word-break: break-all; }
.pagination { display: flex; justify-content: center; margin-top: 20px; }
</style>
