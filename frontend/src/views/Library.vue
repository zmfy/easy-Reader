<template>
  <DefaultLayout>
    <div class="library-page">
      <el-alert
        v-if="pendingBatch && authStore.isAdmin"
        type="warning"
        show-icon
        :closable="false"
        class="batch-alert"
      >
        存在未处理的扫描批次
        <el-button link type="primary" @click="$router.push(`/library/scan-batches/${pendingBatch.id}`)">
          立即审核
        </el-button>
      </el-alert>
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">书库</h1>
          <span class="book-count">{{ pagination.total }} 本</span>
        </div>
        <div class="header-actions">
          <el-input
            v-model="searchQuery"
            placeholder="搜索书名、作者..."
            :prefix-icon="Search"
            clearable
            style="width: 240px"
            @input="debouncedSearch"
          />
          <el-select v-model="selectedCategory" placeholder="分类" clearable style="width: 120px" @change="fetchBooks">
            <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
          </el-select>
          <el-switch
            v-if="authStore.isAdmin"
            v-model="includeDirty"
            inline-prompt
            active-text="显示脏数据"
            inactive-text="仅正常"
            @change="fetchBooks"
          />
          <el-button v-if="authStore.isAdmin" type="primary" :loading="scanStore.isRunning" @click="handleScan">
            <el-icon><Refresh /></el-icon>
            扫描导入
          </el-button>
          <el-button v-if="authStore.isAdmin" @click="$router.push('/library/problems')">
            问题书籍管理
          </el-button>
        </div>
      </div>

      <div v-if="loading" class="loading-grid">
        <el-skeleton v-for="i in 12" :key="i" class="skeleton-card" animated>
          <template #template>
            <el-skeleton-item variant="image" style="aspect-ratio: 3/4; border-radius: 12px" />
            <el-skeleton-item variant="text" style="margin-top: 8px" />
            <el-skeleton-item variant="text" style="width: 60%" />
          </template>
        </el-skeleton>
      </div>

      <div v-else-if="books.length === 0 && seriesList.length === 0" class="empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-title">书库空空如也</div>
        <div class="empty-desc">点击「扫描导入」将 NAS 中的小说导入书库</div>
      </div>

      <div v-else class="books-grid">
        <SeriesCard
          v-for="s in seriesList"
          :key="'series-' + s.id"
          :series="s"
          @click="(series) => router.push(`/library/series/${series.id}`)"
        />
        <BookCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          @click="onBookClick(book)"
          @read="router.push(`/reader/${book.id}`)"
          @detail="router.push(`/book/${book.id}`)"
          @delete="onBookDelete(book)"
        />
      </div>

      <div v-if="pagination.totalPages > 1" class="pagination">
        <el-pagination
          v-model:current-page="pagination.page"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          layout="prev, pager, next"
          background
          @current-change="fetchBooks"
        />
      </div>

      <ScanOptionsDialog v-model="showScanDialog" @confirm="onScanConfirm" />
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch } from 'vue'
import { Search, Refresh } from '@element-plus/icons-vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import SeriesCard from '@/components/SeriesCard.vue'
import ScanOptionsDialog from '@/components/ScanOptionsDialog.vue'
import { libraryApi } from '@/api/library'
import { scanBatchesApi } from '@/api/scan-batches'
import { seriesApi } from '@/api/series'
import { useAuthStore } from '@/stores/auth'
import { useScanTaskStore } from '@/stores/scan-task'
import type { Book, ScanStartOptions, ScanBatch, Series } from '@/types'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const scanStore = useScanTaskStore()

const showScanDialog = ref(false)
const pendingBatch = ref<ScanBatch | null>(null)

async function refreshPendingBatch(): Promise<void> {
  try {
    const resp = await scanBatchesApi.list('pending')
    pendingBatch.value = resp.data.data![0] ?? null
  } catch {
    pendingBatch.value = null
  }
}

const books = ref<Book[]>([])
const seriesList = ref<Series[]>([])
const includeDirty = ref(false)
const loading = ref(false)
const searchQuery = ref((route.query.search as string) || '')
const selectedCategory = ref((route.query.category as string) || '')

const categories = ['玄幻', '修真', '都市', '历史', '科幻', '悬疑', '言情', '武侠', '游戏', '综合']

const pagination = reactive({
  page: Number(route.query.page) || 1,
  pageSize: 24,
  total: 0,
  totalPages: 0,
})

function syncQuery() {
  const query: Record<string, string> = {}
  if (pagination.page > 1) query.page = String(pagination.page)
  if (searchQuery.value) query.search = searchQuery.value
  if (selectedCategory.value) query.category = selectedCategory.value
  router.replace({ query })
}

async function fetchBooks() {
  loading.value = true
  syncQuery()
  try {
    const [booksResp, seriesResp] = await Promise.all([
      libraryApi.listAdmin({
        page: pagination.page,
        pageSize: pagination.pageSize,
        search: searchQuery.value || undefined,
        category: selectedCategory.value || undefined,
        sortBy: 'imported_at',
        sortOrder: 'desc',
        include_dirty: includeDirty.value,
        series_grouped: true,
      }),
      seriesApi.list(),
    ])
    books.value = booksResp.data.data
    Object.assign(pagination, booksResp.data.pagination)
    seriesList.value = seriesResp.data.data ?? []
  } finally {
    loading.value = false
  }
}

function onBookClick(book: Book): void {
  if (book.status === 'duplicate' && book.duplicate_of) {
    router.push(`/book/${book.duplicate_of}`)
  } else {
    router.push(`/book/${book.id}`)
  }
}

async function onBookDelete(book: Book): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除「${book.title}」？\n\n将删除磁盘文件和数据库记录，且不可恢复。`,
      '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch { return }

  const tryDelete = async (opts: { cascade_duplicates?: boolean; confirm_shelf_impact?: boolean } = {}): Promise<boolean> => {
    try {
      await libraryApi.removeWithOptions(book.id, opts)
      ElMessage.success('已删除')
      await fetchBooks()
      return true
    } catch (err: unknown) {
      const e = err as { response?: { status?: number; data?: { code?: string; data?: { duplicate_count?: number; affected_users?: number } } } }
      if (e.response?.status === 409 && e.response.data?.code === 'HAS_DUPLICATES') {
        const cnt = e.response.data.data?.duplicate_count ?? 0
        try {
          await ElMessageBox.confirm(`此书有 ${cnt} 个重复关联，一并删除？`, '级联删除', { type: 'warning' })
          return await tryDelete({ ...opts, cascade_duplicates: true })
        } catch { return false }
      } else if (e.response?.status === 409 && e.response.data?.code === 'AFFECTS_SHELF') {
        const users = e.response.data.data?.affected_users ?? 0
        try {
          await ElMessageBox.confirm(
            `此书已被 ${users} 个用户加入书架，确认删除？\n\n用户书架上的此书会消失。`,
            '影响用户书架',
            { type: 'warning' },
          )
          return await tryDelete({ ...opts, confirm_shelf_impact: true })
        } catch { return false }
      } else {
        ElMessage.error('删除失败')
        return false
      }
    }
  }

  await tryDelete()
}

let searchTimer: ReturnType<typeof setTimeout>
function debouncedSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    pagination.page = 1
    fetchBooks()
  }, 300)
}

async function handleScan(): Promise<void> {
  // Sync from server before deciding — ScanProgressBar polling may have stopped
  await scanStore.refresh()
  if (scanStore.isRunning) {
    if (!scanStore.isPolling) scanStore.startPolling()
    ElMessage.info('已有扫描任务进行中，进度条已显示在顶部')
    return
  }
  await refreshPendingBatch()
  if (pendingBatch.value) {
    ElMessageBox.alert(`存在未处理的待审核批次（${pendingBatch.value.id.slice(0,8)}），请先处理后再扫描。`, '提示', {
      confirmButtonText: '去处理',
      callback: () => router.push(`/library/scan-batches/${pendingBatch.value!.id}`),
    })
    return
  }
  showScanDialog.value = true
}

async function onScanConfirm(options: ScanStartOptions): Promise<void> {
  try {
    await scanStore.startScan(options)
    ElMessage.success('扫描任务已启动')
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { code?: string } } }
    if (e.response?.status === 409) {
      if (e.response.data?.code === 'PENDING_BATCH') {
        ElMessage.warning('请先处理待审核批次')
        await refreshPendingBatch()
      } else {
        ElMessage.warning('已有扫描任务在运行')
        void scanStore.refresh()
      }
    } else {
      ElMessage.error('扫描失败')
    }
  }
}

// 任务完成后刷新书库与 pending batch
watch(() => scanStore.activeTask?.status, (newStatus, oldStatus) => {
  if (oldStatus === 'running' && newStatus !== 'running') {
    void fetchBooks()
    void refreshPendingBatch()
  }
})

onMounted(fetchBooks)
onMounted(refreshPendingBatch)
</script>

<style scoped>
.library-page {
  padding: 32px;
  min-height: 100%;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 28px;
  flex-wrap: wrap;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.page-title {
  font-size: 26px;
  font-weight: 600;
  color: var(--text-0);
  letter-spacing: 1px;
}

.book-count {
  font-size: 14px;
  color: var(--text-2);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.books-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 22px;
  animation: fadeIn 0.3s ease;
}

.loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(172px, 1fr));
  gap: 22px;
}

.skeleton-card {
  padding: 0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  gap: 12px;
}

.empty-icon { font-size: 64px; }
.empty-title { font-size: 20px; color: var(--text-1); font-weight: 500; }
.empty-desc { font-size: 14px; color: var(--text-2); }

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 32px;
}

.batch-alert {
  margin-bottom: 20px;
}
</style>
