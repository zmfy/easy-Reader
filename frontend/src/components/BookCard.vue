<template>
  <div class="book-card" @click="$emit('click')">
    <div class="book-cover">
      <!-- 有封面 -->
      <template v-if="!imgError && book.cover_url">
        <div class="img-skeleton" :class="{ hidden: imgLoaded }" />
        <img
          :src="book.cover_url"
          :alt="displayTitle"
          loading="lazy"
          decoding="async"
          :class="{ loaded: imgLoaded }"
          @load="imgLoaded = true"
          @error="imgError = true"
        />
      </template>
      <!-- 无封面 / 加载失败 -->
      <div v-else class="cover-placeholder" :style="{ background: placeholderGradient }">
        <span class="cover-title">{{ displayTitle }}</span>
      </div>
      <!-- 状态徽章（重复 / 乱码） -->
      <el-tag v-if="badge" :type="badge.type" size="small" class="status-badge">
        {{ badge.label }}
      </el-tag>
      <span v-if="book.rating" class="rating-badge">★ {{ book.rating.toFixed(1) }}</span>
      <!-- AI 填充状态：小圆点（绿 = 已填充，橙 = 失败），悬停显示文字 -->
      <span
        v-if="aiFillBadge"
        class="ai-fill-dot"
        :class="aiFillBadge.type"
        :title="aiFillBadge.label"
        :aria-label="aiFillBadge.label"
        role="img"
      />
      <!-- 悬停操作（仅鼠标设备）：封面底部渐变区放「阅读」；点卡片其他位置进书页。触屏上不显示，避免误触 -->
      <div class="cover-overlay">
        <el-button type="primary" size="small" class="overlay-read" @click.stop="$emit('read')">
          <el-icon><IconPlayerPlay /></el-icon>
          阅读
        </el-button>
      </div>
      <!-- 底部渐变（有封面时增加层次感） -->
      <div v-if="!imgError && book.cover_url" class="cover-bottom-fade" />
    </div>
    <div class="book-info">
      <div class="book-title" :title="book.title">{{ displayTitle }}</div>
      <div class="book-author">{{ book.author || '未知作者' }}</div>
      <div class="book-meta">
        <span v-if="book.category" class="tag category" :title="categoryLabel(book.category)">{{ categoryLeaf(book.category) }}</span>
        <span class="tag format">{{ book.file_format?.toUpperCase() }}</span>
        <span v-if="book.is_finished" class="tag finished">完结</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { IconPlayerPlay } from '@tabler/icons-vue'
import type { Book } from '@/types'
import { categoryLabel, categoryLeaf } from '@/utils/category'

const props = defineProps<{ book: Book }>()
defineEmits<{ click: []; read: [] }>()

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

const displayTitle = computed(() => props.book.display_title || props.book.title)

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
  border: 1px solid var(--card-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-soft);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
}

.book-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent-line);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--accent) 14%, transparent);
}

.book-card:hover .cover-overlay {
  opacity: 1;
  pointer-events: auto;
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
  background: linear-gradient(90deg, var(--bg-2) 25%, var(--bg-1) 50%, var(--bg-2) 75%);
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
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;   /* 按钮放在封面下部，不挡封面主体 */
  gap: 6px;
  padding: 0 14px 14px;        /* 两侧与底部留白 */
  /* 只压暗下半部分，上半部分封面仍清晰可见 */
  background: linear-gradient(to top, rgba(11, 16, 32, 0.92) 0%, rgba(11, 16, 32, 0.65) 40%, rgba(11, 16, 32, 0) 72%);
  opacity: 0;
  pointer-events: none;        /* 隐藏时不拦截点击：点封面就是进书页 */
  transition: opacity 0.22s ease;
}

/* 触屏没有悬停：不显示浮层，点卡片任何位置都进书页 */
@media (hover: none) {
  .cover-overlay { display: none; }
}

.overlay-read {
  width: 100%;
}

/* 悬停时隐藏 AI 填充圆点，避免压在按钮上 */
.book-card:hover .ai-fill-dot {
  opacity: 0;
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
  background: var(--accent-soft);
  color: var(--accent);
}

.tag.format {
  background: var(--bg-2);
  color: var(--text-1);
}

.tag.finished {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
}

.ai-fill-dot {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 2;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  box-shadow: 0 0 0 2px rgba(11, 16, 32, 0.75);   /* 深色描边，浅色封面上也清晰 */
}
.ai-fill-dot.success { background: var(--success); }
.ai-fill-dot { transition: opacity 0.2s ease; }
.ai-fill-dot.warning { background: var(--warning); }

.rating-badge {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 4;
  font-size: 11px;
  font-weight: 700;
  /* 封面叠加层例外：角标底固定为深色半透明，--warning 在浅色主题偏暗看不清，固定用亮琥珀 */
  color: #fbbf24;
  background: rgba(11, 16, 32, 0.7);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
