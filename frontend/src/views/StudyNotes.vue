<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="学习总结" :count="loaded ? `${items.length} 本` : undefined" />

      <div class="toolbar">
        <el-input v-model="keyword" class="search-input" placeholder="搜索书名、总结内容" clearable>
          <template #prefix>
            <IconSearch :size="16" :stroke-width="1.75" />
          </template>
        </el-input>
        <el-radio-group v-model="sortBy">
          <el-radio-button value="updated">最近更新</el-radio-button>
          <el-radio-button value="title">书名</el-radio-button>
        </el-radio-group>
      </div>

      <div v-if="loading && !loaded" class="loading-state">
        <el-skeleton v-for="i in 4" :key="i" :rows="2" animated />
      </div>

      <div v-else-if="loadFailed" class="empty-state">
        <div class="empty-state-title">加载失败</div>
        <el-button type="primary" @click="load">重试</el-button>
      </div>

      <div v-else-if="sorted.length === 0" class="empty-state">
        <IconNotebook class="empty-icon" :size="48" :stroke-width="1.5" />
        <div v-if="keyword.trim()" class="empty-state-title">没有匹配的学习总结</div>
        <template v-else>
          <div class="empty-state-title">还没有学习总结</div>
          <div class="empty-state-desc">在阅读器里划线、或在学习导图里添加知识点后，这里就能生成学习总结。</div>
        </template>
      </div>

      <div v-else class="card-list">
        <div v-for="item in sorted" :key="item.bookId" class="note-card">
          <div class="card-main">
            <div class="card-title" :class="{ gone: item.bookTitle === null }">{{ item.bookTitle ?? '书已不存在' }}</div>
            <div class="card-meta">{{ metaText(item) }}</div>
            <div v-if="item.themes.length" class="card-tags">
              <span v-for="t in item.themes.slice(0, 5)" :key="t" class="tag">{{ t }}</span>
            </div>
            <div v-if="item.hasSummary && item.newNoteCount > 0" class="badge">有 {{ item.newNoteCount }} 条新笔记未整理</div>
          </div>
          <div class="card-actions">
            <template v-if="isRunning(item)">
              <el-button size="small" disabled>整理中…</el-button>
              <el-button size="small" type="primary" @click="open(item)">打开总结</el-button>
            </template>
            <template v-else-if="item.hasSummary">
              <el-button size="small" type="primary" @click="open(item)">打开总结</el-button>
              <el-button v-if="item.newNoteCount > 0 && item.bookTitle !== null" size="small" @click="open(item, 'update')">更新</el-button>
            </template>
            <el-button v-else-if="item.bookTitle !== null" size="small" type="primary" @click="open(item, 'generate')">生成总结</el-button>
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
/**
 * 学习总结入口页：列出所有有笔记或有总结的书，可搜索；更新/生成跳到总结页并自动开始任务。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { IconNotebook, IconSearch } from '@tabler/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import { studyApi } from '@/api/study'
import { SOURCE_LABEL } from '@/utils/summary-doc'
import { parseServerTime } from '@/utils/time'
import type { SummaryOverview } from '@/types/study'

const router = useRouter()
const items = ref<SummaryOverview[]>([])
const keyword = ref('')
const sortBy = ref<'updated' | 'title'>('updated')
const loading = ref(false)
const loaded = ref(false)
const loadFailed = ref(false)
const POLL_INTERVAL = 3000
let seq = 0
let timer: ReturnType<typeof setTimeout> | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null

const sorted = computed(() => {
  const list = [...items.value]
  if (sortBy.value === 'title') {
    // 书已删除（无书名）的排在最后
    return list.sort((a, b) => {
      if (a.bookTitle === null || b.bookTitle === null) return (a.bookTitle === null ? 1 : 0) - (b.bookTitle === null ? 1 : 0)
      return a.bookTitle.localeCompare(b.bookTitle, 'zh-CN')
    })
  }
  const ts = (i: SummaryOverview) => (i.updatedAt ? parseServerTime(i.updatedAt)?.getTime() ?? 0 : 0)
  return list.sort((a, b) => ts(b) - ts(a))
})

function isRunning(item: SummaryOverview): boolean {
  return item.job?.status === 'running'
}

function metaText(item: SummaryOverview): string {
  if (!item.hasSummary) return `还没有总结 · ${item.noteCount} 条笔记`
  const parts = [`${item.themes.length} 个主题`, `${item.noteCount} 条笔记`]
  const d = item.updatedAt ? parseServerTime(item.updatedAt) : null
  if (d && item.lastSource) {
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    parts.push(`${mm}-${dd} 更新（${SOURCE_LABEL[item.lastSource]}）`)
  }
  return parts.join(' · ')
}

function open(item: SummaryOverview, start?: 'update' | 'generate') {
  router.push({ path: `/book/${item.bookId}/summary`, query: start ? { start } : {} })
}

function clearPoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

async function load() {
  const my = ++seq
  clearPoll()
  loading.value = true
  loadFailed.value = false
  try {
    const q = keyword.value.trim()
    const resp = await studyApi.listSummaries(q || undefined)
    if (my !== seq) return
    items.value = resp.data.data || []
    loaded.value = true
    // 有整理中的任务：定时刷新，直到没有为止
    if (items.value.some(isRunning)) pollTimer = setTimeout(load, POLL_INTERVAL)
  } catch (err: any) {
    if (my !== seq) return
    if (!loaded.value) loadFailed.value = true
    ElMessage.error(err?.response?.data?.message || '学习总结加载失败')
  } finally {
    if (my === seq) loading.value = false
  }
}

watch(keyword, () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 300)
})

onMounted(load)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  clearPoll()
  seq++
})
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
}
.search-input {
  flex: 1;
  min-width: 0;
  max-width: 360px;
}
.card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.note-card {
  background: var(--card-bg);
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  padding: 16px 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  transition: border-color 0.18s ease;
}
.note-card:hover {
  border-color: var(--accent-line);
}
.card-main {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.card-title.gone {
  color: var(--text-2);
}
.card-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-2);
}
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.tag {
  max-width: 100%;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--accent);
  background: var(--accent-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  display: inline-block;
  margin-top: 8px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--accent);
  border: 1px solid var(--accent-line);
}
.card-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.empty-icon { color: var(--text-2); opacity: 0.6; }
.loading-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

@media (max-width: 768px) {
  .search-input { max-width: none; flex-basis: 100%; }
  .note-card { flex-direction: column; align-items: stretch; gap: 12px; padding: 16px; }
  .card-actions { justify-content: flex-end; }
}
</style>
