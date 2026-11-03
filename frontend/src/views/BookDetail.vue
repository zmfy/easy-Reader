<template>
  <DefaultLayout>
    <div class="book-detail-page">
      <div v-if="loading" class="loading-state">
        <el-skeleton :rows="8" animated />
      </div>
      <div v-else-if="book" class="detail-content">
        <div class="detail-header">
          <el-button :icon="ArrowLeft" text @click="router.back()">返回</el-button>
        </div>

        <div class="detail-main">
          <div class="cover-section">
            <div class="book-cover-large">
              <img v-if="book.cover_url" :src="book.cover_url" :alt="book.title" />
              <div v-else class="cover-placeholder-large">
                <span class="format-label">{{ book.file_format?.toUpperCase() }}</span>
                <span class="title-label">{{ book.title }}</span>
              </div>
            </div>
            <div class="cover-actions">
              <el-button type="primary" size="large" @click="router.push(`/reader/${book.id}`)">
                <el-icon><VideoPlay /></el-icon>
                开始阅读
              </el-button>
              <el-button size="large" @click="handleAddToShelf" :loading="addingShelf">
                <el-icon><Plus /></el-icon>
                加入书架
              </el-button>
            </div>
          </div>

          <div class="info-section">
            <div class="info-header">
              <div v-if="!editing">
                <h1 class="book-title">{{ book.title }}</h1>
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
              </div>
              <div class="edit-actions">
                <template v-if="authStore.isAdmin">
                  <el-button v-if="!editing" size="small" @click="startEdit">编辑</el-button>
                  <template v-else>
                    <el-button size="small" type="primary" @click="saveEdit" :loading="saving">保存</el-button>
                    <el-button size="small" @click="cancelEdit">取消</el-button>
                  </template>
                  <el-tooltip
                    placement="top"
                    :content="aiConfigured ? 'AI 不会覆盖 admin 修改过的字段。想让 AI 重写，请先清空对应字段再保存。' : '未配置 AI 插件，请先在「AI 插件设置」中配置'"
                  >
                    <el-button
                      size="small"
                      :loading="aiFilling"
                      :disabled="!aiConfigured"
                      @click="handleAiFill"
                    >
                      <el-icon><MagicStick /></el-icon>
                      AI 填充
                    </el-button>
                  </el-tooltip>
                </template>
              </div>
              <el-alert
                v-if="authStore.isAdmin && editedFieldsList.length > 0"
                type="info"
                show-icon
                :closable="false"
                class="ai-protect-alert"
              >
                <template #title>已手动编辑的字段：{{ editedFieldsList.join('、') }}</template>
                <template #default>
                  这些字段已被锁定，AI 填充不会覆盖。如需重写，请清空字段并保存后再点 AI 填充。
                </template>
              </el-alert>
            </div>

            <div class="info-tags">
              <el-tag v-if="book.category">{{ book.category }}</el-tag>
              <el-tag type="info">{{ book.file_format?.toUpperCase() }}</el-tag>
              <el-tag v-if="book.is_finished" type="success">完结</el-tag>
              <el-tag v-else type="warning">连载中</el-tag>
            </div>

            <div class="info-meta">
              <div v-if="book.publish_date" class="meta-item">
                <span class="meta-label">发布时间</span>
                <span class="meta-value">{{ book.publish_date }}</span>
              </div>
              <div v-if="book.finish_date" class="meta-item">
                <span class="meta-label">完结时间</span>
                <span class="meta-value">{{ book.finish_date }}</span>
              </div>
              <div v-if="book.file_size" class="meta-item">
                <span class="meta-label">文件大小</span>
                <span class="meta-value">{{ formatSize(book.file_size) }}</span>
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
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, VideoPlay, Plus, MagicStick } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { libraryApi } from '@/api/library'
import { shelfApi } from '@/api/shelf'
import { settingsApi } from '@/api/settings'
import { useAuthStore } from '@/stores/auth'
import type { Book, BookAiMetadata } from '@/types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const book = ref<Book | null>(null)
const aiMeta = ref<BookAiMetadata | null>(null)
// Map: similar-work title → in-library book id (if found)
const similarLinks = ref<Map<string, string>>(new Map())
const loading = ref(false)
const editing = ref(false)
const saving = ref(false)
const aiFilling = ref(false)
const aiConfigured = ref(true)
const addingShelf = ref(false)

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

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function fetchBook() {
  loading.value = true
  try {
    const id = route.params.bookId as string
    const [bookResp, metaResp] = await Promise.all([
      libraryApi.get(id),
      libraryApi.getAiMetadata(id).catch(() => null),
    ])
    book.value = bookResp.data.data || null
    aiMeta.value = metaResp?.data.data ?? null

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

async function refreshAiMeta(): Promise<void> {
  if (!book.value) return
  try {
    const resp = await libraryApi.getAiMetadata(book.value.id)
    aiMeta.value = resp.data.data ?? null
  } catch { /* ignore */ }
}

function startEdit() {
  if (!book.value) return
  editForm.title = book.value.title
  editForm.author = book.value.author || ''
  editForm.summary = book.value.summary || ''
  editForm.category = book.value.category || ''
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function saveEdit() {
  saving.value = true
  try {
    const resp = await libraryApi.update(route.params.bookId as string, editForm)
    book.value = resp.data.data || null
    editing.value = false
    ElMessage.success('保存成功')
  } finally {
    saving.value = false
  }
}

async function handleAiFill() {
  aiFilling.value = true
  try {
    const resp = await libraryApi.aiFill(route.params.bookId as string)
    book.value = resp.data.data || null
    await refreshAiMeta()
    ElMessage.success('AI 填充成功')
  } catch (err: unknown) {
    ElMessage.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message || 'AI 填充失败')
  } finally {
    aiFilling.value = false
  }
}

async function handleAddToShelf() {
  if (!book.value) return
  addingShelf.value = true
  try {
    await shelfApi.add(book.value.id)
    ElMessage.success('已加入书架')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
    if (msg?.includes('已在书架')) {
      ElMessage.info('该书已在书架中')
    } else {
      ElMessage.error('添加失败')
    }
  } finally {
    addingShelf.value = false
  }
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

.detail-main {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 40px;
  align-items: start;
}

@media (max-width: 768px) {
  .detail-main {
    grid-template-columns: 1fr;
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
    grid-template-columns: 110px 1fr;
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

  .format-label {
    font-size: 11px;
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
    height: 40px;
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
  background: linear-gradient(135deg, var(--bg-2), rgba(124, 92, 255, 0.2));
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 12px;
}

.format-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 2px;
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

.cover-actions :deep(.el-button) {
  width: 100%;
  margin-left: 0 !important;
}

.info-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
  gap: 16px;
}

.book-title {
  font-size: 28px;
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
.book-rating .rating-star { color: #ffb400; font-size: 18px; }
.book-rating .rating-score { color: #ffb400; font-size: 22px; font-weight: 700; }
.book-rating .rating-source { font-size: 12px; color: var(--text-2); }

.edit-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.ai-protect-alert {
  margin-top: 12px;
  width: 100%;
}

.ai-meta-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid rgba(124, 92, 255, 0.1);
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
.in-library-tag { margin-left: 6px; vertical-align: middle; }
</style>
