<template>
  <DefaultLayout>
    <div class="library-page">
      <!-- 书库为空：管理入口展开成大卡片，引导第一次导入 -->
      <LibraryManageCard v-if="authStore.isAdmin && libraryEmpty" expanded @changed="fetchBooks" />
      <div class="page-header">
        <div class="header-left">
          <h1 class="page-title">书库</h1>
          <span class="book-count">{{ pagination.total }} 本</span>
          <!-- 平时：标题旁的「导入与管理」按钮，不占地方 -->
          <LibraryManageCard v-if="authStore.isAdmin && !libraryEmpty" @changed="fetchBooks" />
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
                      <li><strong>错标</strong>：只看 AI 判定文件名与正文不是同一本书的</li>
                    </template>
                  </ul>
                  <div v-if="authStore.isAdmin" class="help-note">
                    「重复 / ai填充 / 填充失败 / 错标」为精确触发的筛选词，输入其它内容均按书名/作者搜索。
                  </div>
                </div>
              </el-popover>
            </template>
          </el-input>
          <!-- 宽屏：分类与排序直接显示 -->
          <div class="filters-inline">
            <el-cascader
              v-model="selectedCategory"
              :options="categoryOptions"
              :props="CASCADER_PROPS"
              :show-all-levels="false"
              placeholder="分类"
              clearable
              style="width: 150px"
              @change="onCategoryChange"
            />
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
              <el-cascader
                v-model="selectedCategory"
                :options="categoryOptions"
                :props="CASCADER_PROPS"
                placeholder="全部分类"
                clearable
                teleported
                style="width: 100%"
                @change="onCategoryChange"
              />
              <div class="filters-pop-label">排序</div>
              <el-select v-model="sortBy" teleported style="width: 100%" @change="fetchBooks">
                <el-option v-for="o in sortOptions" :key="o.value" :label="o.label" :value="o.value" />
              </el-select>
            </div>
          </el-popover>
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

      <div v-else-if="books.length === 0" class="empty-state">
        <IconBooks class="empty-icon" :size="48" :stroke-width="1.5" />
        <div class="empty-state-title">书库空空如也</div>
        <div class="empty-state-desc">{{ authStore.isAdmin ? (libraryEmpty ? '点上方「扫描导入」，把 NAS 书库目录里的小说导入进来' : '没有符合条件的书') : '管理员导入书籍后会显示在这里' }}</div>
      </div>

      <div v-else class="books-grid">
        <BookCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          @click="onBookClick(book)"
          @read="router.push(`/reader/${book.id}`)"
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


    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { IconSearch, IconHelpCircle, IconFilter, IconBooks } from '@tabler/icons-vue'
import { useRouter, useRoute } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import LibraryManageCard from '@/components/LibraryManageCard.vue'
import { libraryApi } from '@/api/library'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types'
import { toCategoryOptions, type CategoryOption } from '@/utils/category'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

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

// 多级分类：可选任意一级（选上级即包含全部下级），值为完整路径；选项带书数
const CASCADER_PROPS = { checkStrictly: true, emitPath: false }
const categoryOptions = ref<CategoryOption[]>([])
async function fetchCategories() {
  try {
    const resp = await libraryApi.categories()
    const info = resp.data.data!
    categoryOptions.value = toCategoryOptions(info.tree, info.counts)
  } catch { /* 分类菜单取不到不影响书库列表 */ }
}

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
    if (raw === '错标') return { ...base, mismatch: '1' }
  }
  return { ...base, search: raw || undefined }
}

// 书库真的是空的（不是搜索 / 筛选没结果）：管理入口展开成大卡片
const loadedOnce = ref(false)
const libraryEmpty = computed(() => loadedOnce.value && pagination.total === 0 && !searchQuery.value.trim() && !selectedCategory.value)

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
    loadedOnce.value = true
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

let searchTimer: ReturnType<typeof setTimeout>
function debouncedSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    pagination.page = 1
    fetchBooks()
  }, 300)
}

onMounted(fetchBooks)
onMounted(fetchCategories)
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
  align-items: center;
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
  margin-left: auto;   /* 宽屏：搜索与筛选靠右 */
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

/* 窄屏手机：第一行标题；第二行搜索框占满整行 + 筛选按钮
   （flex 子项默认按内容宽度撑开，会超出右侧边距）；两列卡片，否则 172px 最小宽度只能排一列 */
@media (max-width: 480px) {
  .page-header {
    gap: 12px;
    margin-bottom: 20px;
  }
  .header-left { order: 1; }
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
</style>
