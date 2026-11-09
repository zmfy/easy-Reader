<template>
  <DefaultLayout>
    <div class="book-detail-page">
      <div v-if="loading" class="loading-state">
        <el-skeleton :rows="8" animated />
      </div>
      <div v-else-if="book" class="detail-content">
        <div class="detail-header">
          <el-button class="back-btn" text @click="goBack">
            <IconChevronLeft :size="16" :stroke-width="1.75" />返回
          </el-button>
        </div>

        <div class="detail-main">
          <div class="cover-section">
            <div class="book-cover-large">
              <img v-if="book.cover_url" :src="book.cover_url" :alt="displayTitle" />
              <div v-else class="cover-placeholder-large">
                <span class="title-label">{{ displayTitle }}</span>
              </div>
            </div>
            <div class="cover-actions">
              <el-button type="primary" class="read-btn" :title="readLabel" @click="router.push(`/reader/${book.id}`)">
                <IconPlayerPlay :size="16" :stroke-width="1.75" />
                <span class="btn-label">{{ readLabel }}</span>
              </el-button>
              <!-- 已在书架时显示状态，再点一次移出书架 -->
              <el-button
                :loading="shelfBusy"
                :title="onShelf ? '点击移出书架' : '加入书架'"
                @click="toggleShelf"
              >
                <component :is="onShelf ? IconCheck : IconPlus" :size="16" :stroke-width="1.75" />
                {{ onShelf ? '已在书架' : '加入书架' }}
              </el-button>
            </div>
          </div>

          <div class="info-section">
            <div class="info-header">
              <div v-if="!editing">
                <h1 class="book-title" :title="displayTitle !== book.title ? `文件名：${book.title}` : undefined">{{ displayTitle }}</h1>
                <p class="book-author">
                  <a v-if="book.author" class="author-link" @click="router.push({ path: '/library', query: { search: book.author } })">{{ book.author }}</a>
                  <span v-else>未知作者</span>
                </p>
                <p v-if="book.rating" class="book-rating">
                  <span class="rating-star">★</span>
                  <span class="rating-score">{{ book.rating.toFixed(1) }}</span>
                  <span class="rating-source">豆瓣</span>
                </p>
              </div>
              <div v-else class="edit-fields">
                <el-input v-model="editForm.title" placeholder="书名" />
                <el-input v-model="editForm.author" placeholder="作者" />
                <el-cascader
                  v-model="editForm.category"
                  :options="categoryOptions"
                  :props="{ checkStrictly: true, emitPath: false }"
                  :placeholder="editForm.category ? `${editForm.category}（旧分类）` : '分类'"
                  clearable
                  filterable
                />
              </div>
              <div class="header-side">
                <div class="edit-actions">
                  <template v-if="authStore.isAdmin">
                    <el-button v-if="!editing" @click="startEdit">编辑</el-button>
                    <template v-else>
                      <el-button type="primary" @click="saveEdit" :loading="saving">保存</el-button>
                      <el-button @click="cancelEdit">取消</el-button>
                    </template>
                    <el-tooltip
                      placement="top"
                      :content="aiConfigured ? 'AI 搜索完成后先弹出预览，确认后才保存；手动修改过的字段默认保留。' : '未配置 AI 插件，请先在「AI 插件设置」中配置'"
                    >
                      <el-button
                        :loading="aiPreviewLoading"
                        :disabled="!aiConfigured"
                        @click="handleAiFill"
                      >
                        <IconWand v-if="!aiPreviewLoading" :size="16" :stroke-width="1.75" />
                        AI 填充
                      </el-button>
                    </el-tooltip>
                  </template>
                </div>
                <el-tooltip
                  v-if="authStore.isAdmin && editedFieldsList.length > 0"
                  placement="bottom-end"
                  content="手动编辑过的字段已锁定：AI 填充预览中默认保留现有内容，可在预览中改用 AI 结果。"
                >
                  <div class="locked-hint">
                    <IconLock :size="14" :stroke-width="1.75" />
                    <span>已锁定：{{ editedFieldsList.join('、') }}</span>
                  </div>
                </el-tooltip>
              </div>
            </div>

            <div class="info-tags">
              <router-link
                v-if="book.category"
                :to="{ path: '/library', query: { category: book.category } }"
                class="category-link"
                title="查看同类书"
              >
                <el-tag>{{ categoryLabel(book.category) }}</el-tag>
              </router-link>
              <el-tag type="info">{{ book.file_format?.toUpperCase() }}<template v-if="book.file_size"> · {{ formatSize(book.file_size) }}</template></el-tag>
              <el-tag v-if="book.is_finished" type="success">完结</el-tag>
              <el-tag v-else type="warning">连载中</el-tag>
            </div>

            <div v-if="book.publish_date || book.finish_date" class="info-meta">
              <div v-if="book.publish_date" class="meta-item">
                <span class="meta-label">发布时间</span>
                <span class="meta-value">{{ book.publish_date }}</span>
              </div>
              <div v-if="book.finish_date" class="meta-item">
                <span class="meta-label">完结时间</span>
                <span class="meta-value">{{ book.finish_date }}</span>
              </div>
            </div>

            <div class="summary-section">
              <div class="summary-label">故事简介</div>
              <div v-if="!editing" class="summary-text">
                {{ book.summary || '暂无简介' }}
              </div>
              <el-input
                v-else
                v-model="editForm.summary"
                type="textarea"
                :rows="6"
                placeholder="故事简介"
              />
            </div>

            <div v-if="aiMeta && aiMeta.recommended_tags.length > 0" class="ai-meta-section">
              <div class="summary-label">推荐标签</div>
              <div class="tag-list">
                <el-tag v-for="tag in aiMeta.recommended_tags" :key="tag" size="small">{{ tag }}</el-tag>
              </div>
            </div>

            <div v-if="aiMeta && aiMeta.similar_works.length > 0" class="ai-meta-section">
              <div class="summary-label">类似作品</div>
              <ul class="similar-list">
                <li v-for="w in aiMeta.similar_works" :key="w.title">
                  <router-link
                    v-if="similarLinks.get(w.title)"
                    :to="`/book/${similarLinks.get(w.title)}`"
                    class="similar-link"
                  >
                    <strong>《{{ w.title }}》</strong>
                    <el-tag size="small" type="success" class="in-library-tag">本库已有</el-tag>
                  </router-link>
                  <strong v-else>《{{ w.title }}》</strong>
                  <span v-if="w.author" class="similar-author">— {{ w.author }}</span>
                  <span v-if="w.reason" class="similar-reason">：{{ w.reason }}</span>
                </li>
              </ul>
            </div>

            <div v-if="aiMeta?.adaptations?.length" class="ai-meta-section">
              <div class="summary-label">改编作品</div>
              <ul class="similar-list">
                <li v-for="a in aiMeta.adaptations" :key="a.url">
                  <el-tag size="small" type="info" :title="a.type === '短剧' ? SHORT_DRAMA_HINT : undefined">{{ a.type }}</el-tag>
                  <a :href="a.url" target="_blank" rel="noopener noreferrer" class="similar-link adapt-link">{{ a.title }}</a>
                  <span class="similar-author">{{ [a.year, ADAPTATION_SOURCE_LABELS[a.source]].filter(Boolean).join(' · ') }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
    <AiFillPreviewDialog
      v-if="book"
      v-model="aiPreviewVisible"
      :preview="aiPreview"
      :loading="aiPreviewLoading"
      :book-id="book.id"
      @applied="onAiApplied"
    />
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IconChevronLeft, IconPlayerPlay, IconPlus, IconCheck, IconWand, IconLock } from '@tabler/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import AiFillPreviewDialog from '@/components/AiFillPreviewDialog.vue'
import { libraryApi } from '@/api/library'
import { useShelfToggle } from '@/composables/useShelfToggle'
import { readerApi } from '@/api/reader'
import { readButtonLabel } from '@/utils/reading-label'
import { resolveBack } from '@/utils/page-back'
import { ADAPTATION_SOURCE_LABELS, SHORT_DRAMA_HINT } from '@/utils/ai-fill-form'
import { categoryLabel, toCategoryOptions, type CategoryOption } from '@/utils/category'
import { settingsApi } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'
import type { AiFillPreview, Book, BookAiMetadata, ReadingProgress } from '@/types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const book = ref<Book | null>(null)
const aiMeta = ref<BookAiMetadata | null>(null)
const categoryOptions = ref<CategoryOption[]>([])
// Map: similar-work title → in-library book id (if found)
const similarLinks = ref<Map<string, string>>(new Map())
const loading = ref(false)
const editing = ref(false)
const saving = ref(false)
const aiPreviewLoading = ref(false)
let aiPreviewAbort: AbortController | null = null
const aiPreview = ref<AiFillPreview | null>(null)
const aiPreviewVisible = ref(false)
const aiConfigured = ref(true)
const { onShelf, busy: shelfBusy, refresh: refreshShelf, toggle: toggleShelf } = useShelfToggle(() => book.value?.id ?? (route.params.bookId as string))
const progress = ref<ReadingProgress | null>(null)
const readLabel = computed(() => readButtonLabel(progress.value))
const displayTitle = computed(() => book.value?.display_title || book.value?.title || '')

const editForm = reactive({
  title: '',
  author: '',
  summary: '',
  category: '',
})

// Display friendly labels of fields admin manually edited (AI fill won't overwrite them).
const FIELD_LABELS: Record<string, string> = { title: '标题', author: '作者', summary: '简介', category: '分类' }
const editedFieldsList = computed<string[]>(() => {
  const raw = book.value?.manually_edited_fields
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.map(f => FIELD_LABELS[f as string] ?? String(f))
  } catch { return [] }
})

// 与 PageHeader 一致：有站内历史则回退，直接打开 / 新标签页时回书库
function goBack() {
  const action = resolveBack(true, !!window.history.state?.back, '/library')
  if (action?.type === 'push') router.push(action.path)
  else if (action) router.back()
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function fetchBook() {
  loading.value = true
  try {
    const id = route.params.bookId as string
    const [bookResp, metaResp, , progressResp] = await Promise.all([
      libraryApi.get(id),
      libraryApi.getAiMetadata(id).catch(() => null),
      refreshShelf(),
      readerApi.getProgress(id).catch(() => null),
    ])
    book.value = bookResp.data.data || null
    aiMeta.value = metaResp?.data.data ?? null
    progress.value = progressResp?.data.data ?? null

    // Gate the AI-fill button on whether AI is configured (admin-only feature).
    if (authStore.isAdmin) {
      try {
        const s = await settingsApi.getAiStatus()
        aiConfigured.value = !!s.data.data?.configured
      } catch { aiConfigured.value = false }
    }

    // Resolve "similar works" titles to in-library book ids so the UI can link
    similarLinks.value = new Map()
    const sims = aiMeta.value?.similar_works ?? []
    if (sims.length > 0) {
      try {
        const lookupResp = await libraryApi.lookupByTitles(
          sims.map(s => ({ title: s.title, author: s.author })),
        )
        for (const r of (lookupResp.data.data ?? [])) {
          if (r.book_id) similarLinks.value.set(r.title, r.book_id)
        }
      } catch { /* lookup best-effort */ }
    }
  } finally {
    loading.value = false
  }
}

function startEdit() {
  if (!book.value) return
  editForm.title = book.value.title
  editForm.author = book.value.author || ''
  editForm.summary = book.value.summary || ''
  editForm.category = book.value.category || ''
  editing.value = true
  if (categoryOptions.value.length === 0) {
    libraryApi.categories()
      .then((resp) => { categoryOptions.value = toCategoryOptions(resp.data.data!.tree) })
      .catch(() => { /* 取不到分类表时保留原分类 */ })
  }
}

function cancelEdit() {
  editing.value = false
}

async function saveEdit() {
  saving.value = true
  try {
    // 分类选择器清空时值为 null，后端要字符串
    const resp = await libraryApi.update(route.params.bookId as string, { ...editForm, category: editForm.category || '' })
    book.value = resp.data.data || null
    editing.value = false
    ElMessage.success('保存成功')
  } finally {
    saving.value = false
  }
}

// 点击后立即打开预览弹窗显示加载状态（AI 检索可能需要几秒到一分钟），
// 关闭弹窗或离开页面即取消请求（预览只读，取消无副作用）
async function handleAiFill() {
  cancelAiPreview()
  const controller = new AbortController()
  aiPreviewAbort = controller
  aiPreview.value = null
  aiPreviewLoading.value = true
  aiPreviewVisible.value = true
  try {
    // 先预览：AI 与豆瓣检索结果在弹窗中确认 / 修改后才写入
    const resp = await libraryApi.aiFillPreview(route.params.bookId as string, controller.signal)
    if (controller.signal.aborted) return
    aiPreview.value = resp.data.data ?? null
    if (!aiPreview.value) aiPreviewVisible.value = false
  } catch (err: unknown) {
    if (controller.signal.aborted) return
    aiPreviewVisible.value = false
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI 填充失败')
  } finally {
    if (aiPreviewAbort === controller) {
      aiPreviewAbort = null
      aiPreviewLoading.value = false
    }
  }
}

function cancelAiPreview() {
  aiPreviewAbort?.abort()
  aiPreviewAbort = null
  aiPreviewLoading.value = false
}

watch(aiPreviewVisible, (visible) => { if (!visible) cancelAiPreview() })
onBeforeUnmount(cancelAiPreview)

async function onAiApplied() {
  // 重新加载书籍、AI 元数据与类似作品的书库链接
  await fetchBook()
}

onMounted(fetchBook)
// Re-fetch when navigating between book pages (e.g. clicking a "similar works"
// link): the BookDetail component is reused on /book/:bookId param change, so
// onMounted won't fire again — watch the param to reload the new book.
watch(() => route.params.bookId, () => { fetchBook() })
</script>

<style scoped>
.book-detail-page {
  padding: 32px;
  min-height: 100%;
}

.detail-header {
  margin-bottom: 24px;
}

.back-btn {
  margin-left: -8px;
  padding: 0 8px;
  color: var(--text-1);
}
.back-btn > :deep(span) {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.back-btn:hover { color: var(--accent); }

.detail-main {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 40px;
  align-items: start;
}

@media (max-width: 768px) {
  .detail-main {
    /* minmax(0, …)：列宽不随不换行的内容（如「继续阅读 · 章节名」）撑开，手机上不会被截掉 */
    grid-template-columns: minmax(0, 1fr);
  }
}

/* ── Mobile ── */
@media (max-width: 640px) {
  .book-detail-page {
    padding: 16px;
  }

  .detail-header {
    margin-bottom: 12px;
  }

  .detail-main {
    gap: 0;
  }

  /* Cover + action buttons side by side */
  .cover-section {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    gap: 16px;
    align-items: end;
    margin-bottom: 20px;
  }

  .book-cover-large {
    width: 110px;
    border-radius: var(--radius-md);
  }

  .cover-placeholder-large {
    gap: 8px;
    padding: 10px 6px;
  }

  .title-label {
    font-size: 11px;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cover-actions {
    margin-top: 0;
    align-self: end;
    gap: 8px;
  }

  .cover-actions :deep(.el-button) {
    font-size: 14px;
  }

  /* Info: title stacks above edit buttons */
  .info-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 12px;
  }

  .book-title {
    font-size: 20px;
    line-height: 1.4;
    word-break: break-all;
  }

  .book-author {
    font-size: 14px;
    margin-top: -4px;
  }

  .edit-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .info-tags {
    margin-bottom: 14px;
  }

  .info-meta {
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }

  .summary-section {
    padding: 16px;
  }

  .summary-text {
    font-size: 14px;
    line-height: 1.9;
  }
}

.book-cover-large {
  width: 100%;
  aspect-ratio: 3/4;
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-soft);
}

.book-cover-large img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder-large {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--bg-2), var(--accent-soft));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 12px;
}

.title-label {
  font-size: 16px;
  color: var(--text-1);
  text-align: center;
  line-height: 1.5;
}

.cover-actions {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cover-actions :deep(.el-button > span),
.edit-actions :deep(.el-button > span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.cover-actions :deep(.el-button) {
  width: 100%;
  margin-left: 0 !important;
}

/* 「继续阅读 · 章节名」过长时省略，完整内容见悬停提示 */
.read-btn .btn-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.read-btn > :deep(span) {
  min-width: 0;
  max-width: 100%;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.book-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--text-0);
  line-height: 1.3;
  margin-bottom: 8px;
}

.book-author {
  font-size: 16px;
  color: var(--text-2);
}

.author-link {
  color: var(--text-2);
  text-decoration: none;
  cursor: pointer;
  border-bottom: 1px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.author-link:hover {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.book-rating {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 8px;
}
.book-rating .rating-star { color: var(--warning); font-size: 18px; }
.book-rating .rating-score { color: var(--warning); font-size: 22px; font-weight: 700; }
.book-rating .rating-source { font-size: 12px; color: var(--text-2); }

.edit-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.header-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  flex-shrink: 0;
}

/* 窄屏标题与按钮上下排列：按钮与锁定提示左对齐（需写在上面规则之后才能覆盖） */
@media (max-width: 640px) {
  .header-side {
    width: 100%;
    align-items: flex-start;
  }
}

.edit-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.info-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.info-meta {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.meta-item {
  background: var(--bg-1);
  border-radius: var(--radius-md);
  padding: 10px 14px;
}

.meta-label {
  display: block;
  font-size: 11px;
  color: var(--text-2);
  margin-bottom: 4px;
}

.meta-value {
  font-size: 14px;
  color: var(--text-0);
  font-weight: 500;
}

.summary-section {
  background: var(--bg-1);
  border-radius: var(--radius-md);
  padding: 20px;
}

.summary-label {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
  margin-bottom: 10px;
}

.summary-text {
  font-size: 15px;
  color: var(--text-1);
  line-height: 1.8;
  white-space: pre-wrap;
}

.loading-state {
  padding: 40px;
}

.locked-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-2);
  cursor: help;
}

.ai-meta-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--card-border);
}
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.similar-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0 0;
}
.similar-list li {
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-1);
  line-height: 1.6;
}
.similar-author {
  color: var(--text-2);
  margin-left: 4px;
}
.similar-reason {
  color: var(--text-2);
}
.similar-link {
  color: var(--accent, var(--el-color-primary));
  text-decoration: none;
}
.similar-link:hover { text-decoration: underline; }
.adapt-link { margin-left: 6px; }
.category-link { text-decoration: none; }
.in-library-tag { margin-left: 6px; vertical-align: middle; }
</style>
