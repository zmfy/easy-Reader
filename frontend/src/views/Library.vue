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
            placeholder="搜索书名、作者"
            clearable
            class="search-input"
            @input="debouncedSearch"
          >
            <template #prefix>
              <IconSearch :size="16" :stroke-width="1.75" />
            </template>
            <template #suffix>
              <el-popover placement="bottom-end" :width="320" trigger="click">
                <template #reference>
                  <span class="search-help" title="搜索帮助"><IconHelpCircle :size="16" :stroke-width="1.75" /></span>
                </template>
                <div class="search-help-pop">
                  <div class="help-title">搜索框用法</div>
                  <ul>
                    <li><strong>书名 / 作者</strong>：直接输入关键词，模糊匹配</li>
                    <li>清空搜索框：显示全部书籍</li>
                    <template v-if="authStore.isAdmin">
                      <li><strong>重复</strong>：显示所有重复的书（含审核后保留的正常本）</li>
                      <li><strong>ai填充</strong> / <strong>已填充</strong>：只看已 AI 填充的书</li>
                      <li><strong>填充失败</strong>：只看 AI 填充失败的书</li>
                    </template>
                  </ul>
                  <div v-if="authStore.isAdmin" class="help-note">
                    「重复 / ai填充 / 填充失败」为精确触发的筛选词，输入其它内容均按书名/作者搜索。
                  </div>
                </div>
              </el-popover>
            </template>
          </el-input>
          <!-- 宽屏：分类与排序直接显示 -->
          <div class="filters-inline">
            <el-select v-model="selectedCategory" placeholder="分类" clearable style="width: 120px" @change="onCategoryChange">
              <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
            </el-select>
            <el-select v-model="sortBy" style="width: 160px" @change="fetchBooks">
              <el-option v-for="o in sortOptions" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
          </div>
          <!-- 窄屏：收进「筛选」弹出层；选了分类时按钮高亮 -->
          <el-popover placement="bottom-end" :width="240" trigger="click">
            <template #reference>
              <el-button class="filter-btn" :type="selectedCategory ? 'primary' : 'default'" title="筛选与排序">
                <IconFilter :size="16" :stroke-width="1.75" />
              </el-button>
            </template>
            <div class="filters-pop">
              <div class="filters-pop-label">分类</div>
              <el-select v-model="selectedCategory" placeholder="全部分类" clearable teleported style="width: 100%" @change="onCategoryChange">
                <el-option v-for="cat in categories" :key="cat" :label="cat" :value="cat" />
              </el-select>
              <div class="filters-pop-label">排序</div>
              <el-select v-model="sortBy" teleported style="width: 100%" @change="fetchBooks">
                <el-option v-for="o in sortOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </div>
          </el-popover>
        </div>
        <el-button
          v-if="authStore.isAdmin"
          type="primary"
          class="scan-btn"
          :loading="scanStore.isRunning"
          title="扫描导入"
          @click="handleScan"
        >
          <IconRefresh v-if="!scanStore.isRunning" class="scan-icon" :size="16" :stroke-width="1.75" />
          <span class="btn-text">扫描导入</span>
        </el-button>
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

      <div v-else-if="books.length === 0" class="empty-state">
        <IconBooks class="empty-icon" :size="48" :stroke-width="1.5" />
        <div class="empty-state-title">书库空空如也</div>
        <div class="empty-state-desc">点击「扫描导入」将 NAS 中的小说导入书库</div>
      </div>

      <div v-else class="books-grid">
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
import { IconSearch, IconHelpCircle, IconFilter, IconRefresh, IconBooks } from '@tabler/icons-vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import ScanOptionsDialog from '@/components/ScanOptionsDialog.vue'
import { libraryApi } from '@/api/library'
import { scanBatchesApi } from '@/api/scan-batches'
import { useAuthStore } from '@/stores/auth'
import { useScanTaskStore } from '@/stores/scan-task'
import { deleteBookWithPrompts } from '@/composables/useBookDelete'
import type { Book, ScanStartOptions, ScanBatch } from '@/types'

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
const loading = ref(false)
const searchQuery = ref((route.query.search as string) || '')
const selectedCategory = ref((route.query.category as string) || '')
const sortOptions: Array<{ value: 'imported_at' | 'title' | 'rating'; label: string }> = [
  { value: 'imported_at', label: '入库时间（最新）' },
  { value: 'title', label: '书名（A→Z）' },
  { value: 'rating', label: '网络评分（高→低）' },
]
const sortBy = ref<'imported_at' | 'title' | 'rating'>(
  (route.query.sort as 'imported_at' | 'title' | 'rating') || 'imported_at',
)

function sortOrderFor(field: string): 'asc' | 'desc' {
  // title is alphabetical; imported_at and rating sort newest/highest first
  return field === 'title' ? 'asc' : 'desc'
}

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
  if (sortBy.value !== 'imported_at') query.sort = sortBy.value
  router.replace({ query })
}

type ListParams = Parameters<typeof libraryApi.listAdmin>[0]

function resolveListParams(): ListParams {
  const raw = searchQuery.value.trim()
  const base: ListParams = {
    page: pagination.page,
    pageSize: pagination.pageSize,
    category: selectedCategory.value || undefined,
    sortBy: sortBy.value,
    sortOrder: sortOrderFor(sortBy.value),
    series_grouped: false,
  }
  if (authStore.isAdmin) {
    if (raw === '重复') return { ...base, status: 'duplicate_groups' }
    if (raw === 'ai填充' || raw === '已填充') return { ...base, ai_fill: 'filled' }
    if (raw === '填充失败') return { ...base, ai_fill: 'failed' }
  }
  return { ...base, search: raw || undefined }
}

// 请求序号：搜索 / 切换条件较快时，只采用最后一次请求的结果，避免慢响应覆盖新结果
let fetchSeq = 0

async function fetchBooks() {
  const seq = ++fetchSeq
  loading.value = true
  syncQuery()
  try {
    const booksResp = await libraryApi.listAdmin(resolveListParams())
    if (seq !== fetchSeq) return
    books.value = booksResp.data.data
    Object.assign(pagination, booksResp.data.pagination)
  } finally {
    if (seq === fetchSeq) loading.value = false
  }
}

// 切换分类后结果集变化，回到第 1 页（否则可能停在不存在的页码上显示为空）
function onCategoryChange() {
  pagination.page = 1
  fetchBooks()
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

  const result = await deleteBookWithPrompts(book.id)
  if (!result) return
  ElMessage.success('已删除')
  await fetchBooks()
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

.book-count {
  font-size: 14px;
  color: var(--text-2);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-left: auto;   /* 宽屏：搜索与筛选靠右，紧挨扫描按钮 */
}

.scan-btn > :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.search-help {
  display: inline-flex;
  color: var(--text-2);
  cursor: pointer;
  transition: color 0.2s;
}
.search-help:hover { color: var(--accent); }

.search-help-pop .help-title {
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-0);
}
.search-help-pop ul {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
  font-size: 13px;
}
.search-help-pop .help-note {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.5;
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

.search-input {
  width: 300px;
  max-width: 100%;
}

.filters-inline {
  display: flex;
  gap: 12px;
}

/* 窄屏才显示「筛选」按钮 */
.filter-btn {
  display: none;
}

.filters-pop-label {
  margin: 8px 0 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.filters-pop-label:first-child {
  margin-top: 0;
}

/* 手机：页面内边距收窄 */
@media (max-width: 768px) {
  .library-page { padding: 16px; }
}

/* 窄屏手机：第一行标题 + 扫描图标；第二行搜索框占满整行 + 筛选按钮
   （flex 子项默认按内容宽度撑开，会超出右侧边距）；两列卡片，否则 172px 最小宽度只能排一列 */
@media (max-width: 480px) {
  .page-header {
    gap: 12px;
    margin-bottom: 20px;
  }
  .header-left { order: 1; }
  .scan-btn {
    order: 2;
    margin-left: auto;
    padding: 8px 10px;
  }
  .scan-btn .btn-text { display: none; }
  .scan-btn .scan-icon { width: 18px; height: 18px; }
  .header-actions {
    order: 3;
    margin-left: 0;
    width: 100%;
    min-width: 0;
    flex-wrap: nowrap;
    gap: 8px;
  }
  .search-input {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .filters-inline { display: none; }
  .filter-btn { display: inline-flex; }
  .books-grid,
  .loading-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
}

.skeleton-card {
  padding: 0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.empty-icon { color: var(--text-2); opacity: 0.6; }

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 32px;
}

.batch-alert {
  margin-bottom: 20px;
}
</style>
