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
                <p class="book-author">{{ book.author || '未知作者' }}</p>
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
                  <el-button
                    size="small"
                    :loading="aiFilling"
                    @click="handleAiFill"
                  >
                    <el-icon><MagicStick /></el-icon>
                    AI 填充
                  </el-button>
                </template>
              </div>
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
          </div>
        </div>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, VideoPlay, Plus, MagicStick } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import { libraryApi } from '@/api/library'
import { shelfApi } from '@/api/shelf'
import { useAuthStore } from '@/stores/auth'
import type { Book } from '@/types'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const book = ref<Book | null>(null)
const loading = ref(false)
const editing = ref(false)
const saving = ref(false)
const aiFilling = ref(false)
const addingShelf = ref(false)

const editForm = reactive({
  title: '',
  author: '',
  summary: '',
  category: '',
})

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function fetchBook() {
  loading.value = true
  try {
    const resp = await libraryApi.get(route.params.bookId as string)
    book.value = resp.data.data || null
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
</style>
