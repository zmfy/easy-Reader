<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="阅读历史" :count="total > 0 ? `${total} 本` : undefined">
        <template v-if="items.length > 0" #actions>
          <el-button @click="onClear">清空历史</el-button>
        </template>
      </PageHeader>

      <div v-if="loading && items.length === 0" class="empty-state">加载中…</div>
      <div v-else-if="items.length === 0" class="empty-state">
        <IconHistory :size="48" :stroke-width="1.5" />
        <div class="empty-state-title">还没有翻过的书</div>
        <div class="empty-state-desc">在书库或书架里打开过的书会记在这里，最近看的排在最前面</div>
        <el-button type="primary" @click="router.push('/library')">前往书库</el-button>
      </div>

      <template v-else>
        <div class="history-list">
          <!-- 点整行从上次位置继续读；详情 / 从历史移除收进「⋯」菜单 -->
          <div
            v-for="item in items"
            :key="item.book_id"
            class="book-row"
            :title="`继续阅读《${titleOf(item)}》`"
            tabindex="0"
            role="button"
            @click="openBook(item)"
            @keydown.enter.self="openBook(item)"
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
            <div class="row-time">{{ relativeTime(item.opened_at) }}</div>
            <el-dropdown trigger="click" @command="(cmd: string) => onRowCommand(cmd, item)">
              <el-button class="row-more" text :icon="IconDots" title="更多" @click.stop />
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="detail">详情</el-dropdown-item>
                  <el-dropdown-item command="remove" divided>从历史移除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
        <div v-if="items.length < total" class="load-more">
          <el-button :loading="loading" @click="loadMore">加载更多</el-button>
        </div>
      </template>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IconDots, IconHistory } from '@tabler/icons-vue'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import { historyApi } from '@/api/history'
import { relativeTime } from '@/utils/time'
import type { HistoryItem } from '@/types'

const PAGE_SIZE = 30

const router = useRouter()
const items = ref<HistoryItem[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)

function titleOf(item: HistoryItem): string {
  return item.display_title || item.title || ''
}

function progressText(item: HistoryItem): string {
  if (item.chapter_index == null) return '刚翻开，还没有阅读位置'
  return `上次读到 ${item.chapter_title || `第 ${item.chapter_index + 1} 章`}`
}

/** 阅读器会自动回到上次的位置 */
function openBook(item: HistoryItem) {
  router.push(`/reader/${item.book_id}`)
}

async function fetchPage(next: number) {
  loading.value = true
  try {
    const resp = await historyApi.list(next, PAGE_SIZE)
    const data = resp.data.data ?? []
    items.value = next === 1 ? data : [...items.value, ...data.filter(d => !items.value.some(i => i.book_id === d.book_id))]
    total.value = resp.data.pagination?.total ?? items.value.length
    page.value = next
  } catch {
    ElMessage.error('加载阅读历史失败')
  } finally {
    loading.value = false
  }
}

const loadMore = () => fetchPage(page.value + 1)

function onRowCommand(command: string, item: HistoryItem) {
  if (command === 'detail') router.push(`/book/${item.book_id}`)
  else if (command === 'remove') void onRemove(item)
}

async function onRemove(item: HistoryItem) {
  try {
    await historyApi.remove(item.book_id)
    items.value = items.value.filter(i => i.book_id !== item.book_id)
    total.value = Math.max(0, total.value - 1)
  } catch {
    ElMessage.error('移除失败')
  }
}

async function onClear() {
  try {
    await ElMessageBox.confirm('清空全部阅读历史？阅读进度和书架不受影响。', '清空历史', {
      type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消',
    })
  } catch { return }
  try {
    await historyApi.clear()
    items.value = []
    total.value = 0
    ElMessage.success('已清空阅读历史')
  } catch {
    ElMessage.error('清空失败')
  }
}

onMounted(() => fetchPage(1))
</script>

<style scoped>
.history-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.book-row {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  transition: all 0.18s ease;
}
.book-row:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.row-cover {
  width: 40px;
  height: 54px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
}
.row-cover img { width: 100%; height: 100%; object-fit: cover; }
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

.row-info { flex: 1; min-width: 0; }
.row-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-author { font-size: 12px; color: var(--text-2); }
.row-progress {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.row-time { flex-shrink: 0; font-size: 12px; color: var(--text-2); }
.row-more { flex-shrink: 0; font-size: 18px; color: var(--text-2); }

.load-more { display: flex; justify-content: center; margin-top: 16px; }

@media (max-width: 640px) {
  .book-row { gap: 12px; padding: 12px; align-items: flex-start; }
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
  .row-author { font-size: 13px; }
  .row-time { padding-top: 6px; }
}
</style>
