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
        <el-icon class="empty-icon"><CollectionTag /></el-icon>
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
                <img v-if="item.cover_url" :src="item.cover_url" :alt="titleOf(item)" />
                <div v-else class="cover-placeholder">
                  <span>{{ titleOf(item) }}</span>
                </div>
              </div>
              <div class="recent-info">
                <div class="recent-title">{{ titleOf(item) }}</div>
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
            <!-- 点整行继续阅读；详情 / 移出收进「⋯」菜单 -->
            <div
              v-for="item in items"
              :key="item.id"
              class="book-row"
              :title="`继续阅读《${titleOf(item)}》`"
              tabindex="0"
              role="button"
              @click="router.push(`/reader/${item.book_id}`)"
              @keydown.enter.self="router.push(`/reader/${item.book_id}`)"
            >
              <div class="row-cover">
                <img v-if="item.cover_url" :src="item.cover_url" :alt="titleOf(item)" />
                <div v-else class="row-cover-placeholder">{{ item.file_format?.toUpperCase() }}</div>
              </div>
              <div class="row-info">
                <div class="row-title">{{ titleOf(item) }}</div>
                <div class="row-author">{{ item.author || '未知作者' }}</div>
                <div class="row-progress">{{ progressText(item) }}</div>
              </div>
              <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, item)">
                <el-button class="row-more" text :icon="MoreFilled" title="更多" @click.stop />
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="detail">详情</el-dropdown-item>
                    <el-dropdown-item command="remove" divided>移出书架</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { CollectionTag, MoreFilled } from '@element-plus/icons-vue'
import { ref, computed, onMounted } from 'vue'
import { parseServerTime } from '@/utils/time'
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
    .sort((a, b) => (parseServerTime(b.last_read_at)?.getTime() ?? 0) - (parseServerTime(a.last_read_at)?.getTime() ?? 0))
    .slice(0, 3)
)

function formatDate(date: string) {
  const d = parseServerTime(date)
  if (!d) return date
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`
  return d.toLocaleDateString('zh-CN')
}

function titleOf(item: ShelfItem): string {
  return item.display_title || item.title || ''
}

function progressText(item: ShelfItem): string {
  if (item.chapter_index == null) return '未开始'
  const chapter = item.chapter_title || `第 ${item.chapter_index + 1} 章`
  return `读到 ${chapter}${item.last_read_at ? ` · ${formatDate(item.last_read_at)}` : ''}`
}

function onRowCommand(command: string, item: ShelfItem) {
  if (command === 'detail') router.push(`/book/${item.book_id}`)
  else if (command === 'remove') handleRemove(item.book_id)
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
  try {
    await ElMessageBox.confirm('确定从书架移除这本书吗？', '确认移除', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消',
    })
  } catch {
    return  // 取消或关闭确认框
  }
  try {
    await shelfApi.remove(bookId)
    items.value = items.value.filter(i => i.book_id !== bookId)
    ElMessage.success('已从书架移除')
  } catch {
    ElMessage.error('移出失败，请稍后重试')
  }
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
  cursor: pointer;
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

.row-progress {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-more {
  flex-shrink: 0;
  font-size: 18px;
  color: var(--text-2);
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

/* ── Mobile ── */
@media (max-width: 640px) {
  .shelf-page {
    padding: 16px;
  }

  /* Recent cards: single column, no absolute button */
  .recent-books {
    grid-template-columns: 1fr;
  }

  .recent-card {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding-bottom: 12px;
  }

  .recent-info {
    width: calc(100% - 72px); /* cover 60px + gap 12px */
  }

  .recent-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
  }

  .continue-btn {
    position: static;
    align-self: flex-end;
    margin-left: auto;
  }

  .book-row {
    gap: 12px;
    padding: 12px;
  }

  .row-title {
    white-space: normal;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    margin-bottom: 3px;
  }

  .row-author {
    font-size: 13px;
  }

}
</style>
