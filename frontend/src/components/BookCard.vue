<template>
  <div class="book-card" @click="$emit('click')">
    <div class="book-cover">
      <!-- 有封面 -->
      <template v-if="!imgError && book.cover_url">
        <div class="img-skeleton" :class="{ hidden: imgLoaded }" />
        <img
          :src="book.cover_url"
          :alt="book.title"
          loading="lazy"
          decoding="async"
          :class="{ loaded: imgLoaded }"
          @load="imgLoaded = true"
          @error="imgError = true"
        />
      </template>
      <!-- 无封面 / 加载失败 -->
      <div v-else class="cover-placeholder" :style="{ background: placeholderGradient }">
        <span class="cover-format">{{ book.file_format?.toUpperCase() }}</span>
        <span class="cover-title">{{ book.title }}</span>
      </div>
      <!-- 状态徽章（重复 / 乱码） -->
      <el-tag v-if="badge" :type="badge.type" size="small" class="status-badge">
        {{ badge.label }}
      </el-tag>
      <el-tag v-if="aiFillBadge" :type="aiFillBadge.type" size="small" class="ai-fill-badge">
        {{ aiFillBadge.label }}
      </el-tag>
      <!-- 悬停操作层 -->
      <div class="cover-overlay">
        <el-button type="primary" size="small" @click.stop="$emit('read')">
          <el-icon><VideoPlay /></el-icon>
          阅读
        </el-button>
        <el-button size="small" @click.stop="$emit('detail')">详情</el-button>
        <el-button
          v-if="authStore.isAdmin"
          type="danger"
          size="small"
          plain
          @click.stop="$emit('delete', book)"
        >
          删除
        </el-button>
      </div>
      <!-- 底部渐变（有封面时增加层次感） -->
      <div v-if="!imgError && book.cover_url" class="cover-bottom-fade" />
    </div>
    <div class="book-info">
      <div class="book-title" :title="book.title">{{ book.title }}</div>
      <div class="book-author">{{ book.author || '未知作者' }}</div>
      <div class="book-meta">
        <span v-if="book.category" class="tag category">{{ book.category }}</span>
        <span class="tag format">{{ book.file_format?.toUpperCase() }}</span>
        <span v-if="book.is_finished" class="tag finished">完结</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { VideoPlay } from '@element-plus/icons-vue'
import type { Book } from '@/types'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ book: Book }>()
defineEmits<{ click: []; read: []; detail: []; delete: [Book] }>()

const authStore = useAuthStore()

const badge = computed<{ type: 'danger' | 'warning'; label: string } | null>(() => {
  if (props.book.status === 'duplicate') return { type: 'danger', label: '重复' }
  if (props.book.status === 'garbled') return { type: 'warning', label: '乱码' }
  return null
})

const aiFillBadge = computed<{ type: 'success' | 'warning'; label: string } | null>(() => {
  if (props.book.ai_fill_status === 'filled') return { type: 'success', label: 'AI已填充' }
  if (props.book.ai_fill_status === 'failed') return { type: 'warning', label: 'AI填充失败' }
  return null
})

const imgLoaded = ref(false)
const imgError = ref(false)

// 根据书名生成固定渐变色（相同书名始终同色）
const placeholderGradient = computed(() => {
  const str = props.book.title || ''
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  const hue1 = Math.abs(hash) % 360
  const hue2 = (hue1 + 40) % 360
  return `linear-gradient(160deg, hsl(${hue1},40%,22%) 0%, hsl(${hue2},50%,14%) 100%)`
})
</script>

<style scoped>
.book-card {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.08);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.book-card:hover {
  transform: translateY(-5px);
  border-color: rgba(124, 92, 255, 0.3);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(124, 92, 255, 0.12);
}

.book-card:hover .cover-overlay {
  opacity: 1;
}

.book-card:hover .book-cover img {
  transform: scale(1.05);
}

/* ── 封面区域 ── */
.book-cover {
  position: relative;
  aspect-ratio: 3/4;
  overflow: hidden;
  background: var(--bg-2);
}

/* skeleton 占位 */
.img-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, var(--bg-2) 25%, rgba(124,92,255,0.06) 50%, var(--bg-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s infinite;
  transition: opacity 0.3s;
}
.img-skeleton.hidden {
  opacity: 0;
  pointer-events: none;
}

@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* 封面图片 */
.book-cover img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  transition: transform 0.3s ease, opacity 0.3s ease;
  opacity: 0;
}
.book-cover img.loaded {
  opacity: 1;
}

/* 底部渐变遮罩，增加封面深度 */
.cover-bottom-fade {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to top, rgba(11,16,32,0.55) 0%, transparent 100%);
  pointer-events: none;
}

/* 无封面占位 */
.cover-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px 12px;
  gap: 10px;
}

.cover-format {
  font-size: 10px;
  font-weight: 700;
  color: rgba(255,255,255,0.35);
  letter-spacing: 2px;
  text-transform: uppercase;
}

.cover-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255,255,255,0.82);
  text-align: center;
  line-height: 1.5;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-family: 'Noto Serif SC', serif;
  text-shadow: 0 1px 4px rgba(0,0,0,0.5);
}

/* 悬停操作层 */
.cover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(11, 16, 32, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.22s ease;
  backdrop-filter: blur(2px);
}

/* ── 信息区域 ── */
.book-info {
  padding: 10px 12px 12px;
}

.book-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
  line-height: 1.4;
}

.book-author {
  font-size: 11px;
  color: var(--text-2);
  margin-bottom: 7px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.book-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  line-height: 1.5;
}

.tag.category {
  background: rgba(124, 92, 255, 0.15);
  color: var(--accent);
}

.tag.format {
  background: rgba(0, 212, 184, 0.12);
  color: var(--accent-2);
}

.tag.finished {
  background: rgba(255, 184, 108, 0.12);
  color: var(--warning);
}

.status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
}

.ai-fill-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 2;
}
</style>
