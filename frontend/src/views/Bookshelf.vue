<template>
  <DefaultLayout>
    <div class="shelf-page">
      <div class="page-header">
        <h1 class="page-title">我的书架</h1>
        <span class="book-count">{{ items.length }} 本</span>
      </div>

      <div v-if="loading" class="loading-state">
        <el-skeleton v-for="i in 6" :key="i" :rows="2" animated />
      </div>

      <div v-else-if="items.length === 0" class="empty-state">
        <div class="empty-icon">🔖</div>
        <div class="empty-title">书架还是空的</div>
        <div class="empty-desc">去书库添加你喜欢的书吧</div>
        <el-button type="primary" @click="router.push('/library')">前往书库</el-button>
      </div>

      <div v-else>
        <div v-if="recentItems.length > 0" class="section">
          <h2 class="section-title">最近阅读</h2>
          <div class="recent-books">
            <div
              v-for="item in recentItems"
              :key="item.id"
              class="recent-card"
              @click="router.push(`/reader/${item.book_id}`)"
            >
              <div class="recent-cover">
                <img v-if="item.cover_url" :src="item.cover_url" :alt="item.title" />
                <div v-else class="cover-placeholder">
                  <span>{{ item.title }}</span>
                </div>
              </div>
              <div class="recent-info">
                <div class="recent-title">{{ item.title }}</div>
                <div class="recent-author">{{ item.author || '未知作者' }}</div>
                <div class="progress-bar-wrapper">
                  <div class="progress-label">
                    <span>{{ item.chapter_title || (item.chapter_index != null ? `第 ${item.chapter_index + 1} 章` : '未读') }}</span>
                    <span>{{ item.last_read_at ? formatDate(item.last_read_at) : '未读' }}</span>
                  </div>
                </div>
              </div>
              <el-button type="primary" size="small" class="continue-btn">继续阅读</el-button>
            </div>
          </div>
        </div>

        <div class="section">
          <h2 class="section-title">全部书籍</h2>
          <div class="all-books">
            <div
              v-for="item in items"
              :key="item.id"
              class="book-row"
            >
              <div class="row-cover">
                <img v-if="item.cover_url" :src="item.cover_url" :alt="item.title" />
                <div v-else class="row-cover-placeholder">{{ item.file_format?.toUpperCase() }}</div>
              </div>
              <div class="row-info">
                <div class="row-title">{{ item.title }}</div>
                <div class="row-author">{{ item.author || '未知作者' }}</div>
                <div class="row-meta">
                  <span v-if="item.category" class="tag">{{ item.category }}</span>
                </div>
              </div>
              <div class="row-actions">
                <el-button size="small" type="primary" @click="router.push(`/reader/${item.book_id}`)">阅读</el-button>
                <el-button size="small" @click="router.push(`/book/${item.book_id}`)">详情</el-button>
                <el-button size="small" type="danger" @click="handleRemove(item.book_id)">移除</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { shelfApi } from '@/api/shelf'
import type { ShelfItem } from '@/types'

const router = useRouter()
const items = ref<ShelfItem[]>([])
const loading = ref(false)

const recentItems = computed(() =>
  items.value
    .filter(i => i.last_read_at)
    .sort((a, b) => new Date(b.last_read_at!).getTime() - new Date(a.last_read_at!).getTime())
    .slice(0, 3)
)

function formatDate(date: string) {
  const d = new Date(date)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

async function fetchShelf() {
  loading.value = true
  try {
    const resp = await shelfApi.list()
    items.value = resp.data.data || []
  } finally {
    loading.value = false
  }
}

async function handleRemove(bookId: string) {
  await ElMessageBox.confirm('确定从书架移除这本书吗？', '确认移除', {
    type: 'warning',
    confirmButtonText: '移除',
    cancelButtonText: '取消',
  })
  await shelfApi.remove(bookId)
  items.value = items.value.filter(i => i.book_id !== bookId)
  ElMessage.success('已从书架移除')
}

onMounted(fetchShelf)
</script>

<style scoped>
.shelf-page {
  padding: 32px;
  min-height: 100%;
}

.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 28px;
}

.page-title {
  font-size: 26px;
  font-weight: 600;
  color: var(--text-0);
}

.book-count {
  font-size: 14px;
  color: var(--text-2);
}

.section {
  margin-bottom: 36px;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(124, 92, 255, 0.1);
}

.recent-books {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.recent-card {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.1);
  border-radius: var(--radius-lg);
  padding: 16px;
  display: flex;
  gap: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.recent-card:hover {
  border-color: rgba(124, 92, 255, 0.3);
  transform: translateY(-2px);
  box-shadow: var(--shadow-soft);
}

.recent-cover {
  width: 60px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.recent-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: var(--text-2);
  padding: 4px;
  text-align: center;
  word-break: break-all;
}

.recent-info {
  flex: 1;
  min-width: 0;
}

.recent-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.recent-author {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 12px;
}

.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-2);
}

.continue-btn {
  position: absolute;
  right: 16px;
  bottom: 16px;
}

.all-books {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.book-row {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.08);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  transition: all 0.18s ease;
}

.book-row:hover {
  border-color: rgba(124, 92, 255, 0.2);
  background: rgba(124, 92, 255, 0.04);
}

.row-cover {
  width: 40px;
  height: 54px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}

.row-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.row-cover-placeholder {
  width: 100%;
  height: 100%;
  background: var(--bg-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  color: var(--accent);
  font-weight: 700;
}

.row-info {
  flex: 1;
  min-width: 0;
}

.row-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-author {
  font-size: 12px;
  color: var(--text-2);
}

.row-meta {
  margin-top: 4px;
}

.tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(124, 92, 255, 0.15);
  color: var(--accent);
}

.row-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 80px 0;
}

.empty-icon { font-size: 64px; }
.empty-title { font-size: 20px; color: var(--text-1); font-weight: 500; }
.empty-desc { font-size: 14px; color: var(--text-2); }

.loading-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
