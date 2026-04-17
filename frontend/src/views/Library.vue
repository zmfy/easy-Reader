<template>
  <DefaultLayout>
    <div class="library-page">
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
          <el-button v-if="authStore.isAdmin" type="primary" :loading="scanning" @click="handleScan">
            <el-icon><Refresh /></el-icon>
            扫描导入
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

      <div v-else-if="books.length === 0" class="empty-state">
        <div class="empty-icon">📚</div>
        <div class="empty-title">书库空空如也</div>
        <div class="empty-desc">点击「扫描导入」将 NAS 中的小说导入书库</div>
      </div>

      <div v-else class="books-grid">
        <BookCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          @click="router.push(`/book/${book.id}`)"
          @read="router.push(`/reader/${book.id}`)"
          @detail="router.push(`/book/${book.id}`)"
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
import { ref, onMounted, reactive } from 'vue'
import { Search, Refresh } from '@element-plus/icons-vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import BookCard from '@/components/BookCard.vue'
import { libraryApi } from '@/api/library'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const books = ref<Book[]>([])
const loading = ref(false)
const scanning = ref(false)
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
    const resp = await libraryApi.list({
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: searchQuery.value || undefined,
      category: selectedCategory.value || undefined,
      sortBy: 'imported_at',
      sortOrder: 'desc',
    })
    books.value = resp.data.data
    Object.assign(pagination, resp.data.pagination)
  } finally {
    loading.value = false
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

async function handleScan() {
  scanning.value = true
  try {
    await libraryApi.scan()
    ElMessage.success('扫描任务已启动，稍后刷新查看新书')
    setTimeout(fetchBooks, 3000)
  } catch {
    ElMessage.error('扫描失败')
  } finally {
    scanning.value = false
  }
}

onMounted(fetchBooks)
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
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
  animation: fadeIn 0.3s ease;
}

.loading-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
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
</style>
