<template>
  <div class="book-card" @click="$emit('click')">
    <div class="book-cover">
      <img
        v-if="book.cover_url"
        :src="book.cover_url"
        :alt="book.title"
        loading="lazy"
      />
      <div v-else class="cover-placeholder">
        <span class="cover-format">{{ book.file_format?.toUpperCase() }}</span>
        <span class="cover-title">{{ book.title }}</span>
      </div>
      <div class="cover-overlay">
        <el-button type="primary" size="small" @click.stop="$emit('read')">
          <el-icon><VideoPlay /></el-icon>
          阅读
        </el-button>
        <el-button size="small" @click.stop="$emit('detail')">详情</el-button>
      </div>
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
import { VideoPlay } from '@element-plus/icons-vue'
import type { Book } from '@/types'

defineProps<{ book: Book }>()
defineEmits<{
  click: []
  read: []
  detail: []
}>()
</script>

<style scoped>
.book-card {
  background: var(--bg-1);
  border: 1px solid rgba(124, 92, 255, 0.08);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all 0.22s ease;
}

.book-card:hover {
  transform: translateY(-4px);
  border-color: rgba(124, 92, 255, 0.25);
  box-shadow: var(--shadow-soft);
}

.book-card:hover .cover-overlay {
  opacity: 1;
}

.book-cover {
  position: relative;
  aspect-ratio: 3/4;
  overflow: hidden;
}

.book-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.book-card:hover .book-cover img {
  transform: scale(1.04);
}

.cover-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, var(--bg-2) 0%, rgba(124, 92, 255, 0.15) 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px;
  gap: 8px;
}

.cover-format {
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 1px;
  opacity: 0.8;
}

.cover-title {
  font-size: 14px;
  color: var(--text-1);
  text-align: center;
  line-height: 1.4;
  word-break: break-all;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.cover-overlay {
  position: absolute;
  inset: 0;
  background: rgba(11, 16, 32, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.22s ease;
}

.book-info {
  padding: 12px 14px;
}

.book-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.book-author {
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 8px;
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
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
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
</style>
