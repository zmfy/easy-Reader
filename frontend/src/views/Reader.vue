<template>
  <div class="reader-page" :style="readerStyle">
    <!-- Toolbar Top -->
    <div class="reader-toolbar top" :class="{ visible: toolbarVisible }">
      <el-button :icon="ArrowLeft" circle @click="router.back()" />
      <span class="chapter-title">{{ currentChapter?.title || '加载中...' }}</span>
      <div class="toolbar-actions">
        <el-button :icon="Bookmark" circle @click="addBookmarkQuick" />
        <el-button :icon="Setting" circle @click="settingsPanelVisible = true" />
        <el-button :icon="List" circle @click="chapterListVisible = true" />
      </div>
    </div>

    <!-- Content Area -->
    <div
      class="reader-content"
      ref="contentRef"
      @click="toggleToolbar"
      @scroll="handleScroll"
    >
      <div class="content-wrapper">
        <div v-if="loading" class="content-loading">
          <el-skeleton :rows="20" animated />
        </div>
        <div
          v-else
          class="chapter-content"
          v-html="reader.currentContent.value"
          :style="contentStyle"
        />
      </div>
    </div>

    <!-- Toolbar Bottom -->
    <div class="reader-toolbar bottom" :class="{ visible: toolbarVisible }">
      <el-button :icon="ArrowLeft" :disabled="reader.currentChapterIndex.value === 0" @click="goToPrevChapter">上一章</el-button>
      <div class="progress-info">
        {{ reader.currentChapterIndex.value + 1 }} / {{ reader.chapters.value.length }}
      </div>
      <el-button :icon="ArrowRight" :disabled="reader.currentChapterIndex.value >= reader.chapters.value.length - 1" @click="goToNextChapter">下一章</el-button>
    </div>

    <!-- Settings Panel -->
    <el-drawer
      v-model="settingsPanelVisible"
      title="阅读设置"
      direction="rtl"
      size="320px"
      :modal-class="'reader-drawer'"
    >
      <div class="settings-panel">
        <div class="setting-group">
          <div class="setting-label">主题</div>
          <div class="theme-options">
            <button
              v-for="(val, key) in readerStore.themes"
              :key="key"
              class="theme-btn"
              :class="{ active: readerStore.settings.theme === key }"
              :style="{ background: val.backgroundColor, color: val.fontColor }"
              @click="readerStore.applyTheme(key as ReaderSettings['theme'])"
            >{{ themeLabels[key] }}</button>
          </div>
        </div>
        <div class="setting-group">
          <div class="setting-label">字号 {{ readerStore.settings.fontSize }}px</div>
          <el-slider v-model="readerStore.settings.fontSize" :min="12" :max="28" @change="saveSettings" />
        </div>
        <div class="setting-group">
          <div class="setting-label">行高 {{ readerStore.settings.lineHeight }}</div>
          <el-slider v-model="readerStore.settings.lineHeight" :min="1.4" :max="2.5" :step="0.1" @change="saveSettings" />
        </div>
        <div class="setting-group">
          <div class="setting-label">字体</div>
          <el-select v-model="readerStore.settings.fontFamily" @change="saveSettings">
            <el-option label="Noto Serif SC（宋体感）" value="Noto Serif SC" />
            <el-option label="Noto Sans SC（黑体）" value="Noto Sans SC" />
            <el-option label="系统默认" value="system-ui" />
          </el-select>
        </div>
      </div>
    </el-drawer>

    <!-- Chapter List -->
    <el-drawer
      v-model="chapterListVisible"
      title="章节目录"
      direction="ltr"
      size="280px"
    >
      <div class="chapter-list">
        <div
          v-for="ch in reader.chapters.value"
          :key="ch.index"
          class="chapter-item"
          :class="{ active: ch.index === reader.currentChapterIndex.value }"
          @click="jumpToChapter(ch.index)"
        >
          {{ ch.title }}
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watchEffect, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Star, Setting, List } from '@element-plus/icons-vue'
const Bookmark = Star
import { useReader } from '@/composables/useReader'
import { useReaderStore } from '@/stores/reader'
import type { ReaderSettings } from '@/types'

const route = useRoute()
const router = useRouter()
const readerStore = useReaderStore()
const bookId = route.params.bookId as string

const reader = useReader(bookId)
const loading = computed(() => reader.loading.value)
const contentRef = ref<HTMLElement | null>(null)
const toolbarVisible = ref(true)
const settingsPanelVisible = ref(false)
const chapterListVisible = ref(false)

const themeLabels: Record<string, string> = {
  white: '白昼',
  'eye-care': '护眼',
  night: '夜间',
  dark: '深黑',
}

const readerStyle = computed(() => ({
  backgroundColor: readerStore.settings.backgroundColor,
  color: readerStore.settings.fontColor,
}))

const contentStyle = computed(() => ({
  fontFamily: readerStore.settings.fontFamily,
  fontSize: `${readerStore.settings.fontSize}px`,
  lineHeight: readerStore.settings.lineHeight,
  letterSpacing: `${readerStore.settings.letterSpacing}px`,
}))

const currentChapter = computed(() => reader.currentChapter.value)

function toggleToolbar() {
  toolbarVisible.value = !toolbarVisible.value
}

let saveTimer: ReturnType<typeof setTimeout>
function handleScroll() {
  if (!contentRef.value) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    reader.saveProgress(contentRef.value?.scrollTop || 0)
  }, 2000)
}

async function addBookmarkQuick() {
  await reader.addBookmark(contentRef.value?.scrollTop || 0)
}

async function goToPrevChapter() {
  await reader.prevChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function goToNextChapter() {
  await reader.nextChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function jumpToChapter(index: number) {
  chapterListVisible.value = false
  await reader.loadChapter(index)
  await reader.saveProgress(0)
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

function saveSettings() {
  readerStore.updateSettings(readerStore.settings)
}

let toolbarTimer: ReturnType<typeof setTimeout>
watchEffect(() => {
  if (toolbarVisible.value) {
    clearTimeout(toolbarTimer)
    toolbarTimer = setTimeout(() => {
      toolbarVisible.value = false
    }, 4000)
  }
})

onMounted(async () => {
  await reader.loadChapters()
  await reader.loadProgress()
  await reader.loadChapter(reader.progress.value.chapterIndex)
  const savedScrollTop = reader.progress.value.scrollTop
  if (savedScrollTop > 0) {
    await nextTick()
    requestAnimationFrame(() => {
      if (contentRef.value) contentRef.value.scrollTop = savedScrollTop
    })
  }
})

onUnmounted(() => {
  clearTimeout(saveTimer)
  clearTimeout(toolbarTimer)
})
</script>

<style scoped>
.reader-page {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color 0.3s ease, color 0.3s ease;
}

.reader-toolbar {
  position: fixed;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: rgba(11, 16, 32, 0.85);
  backdrop-filter: blur(12px);
  z-index: 100;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.reader-toolbar.top {
  top: 0;
  transform: translateY(-100%);
}

.reader-toolbar.bottom {
  bottom: 0;
  transform: translateY(100%);
}

.reader-toolbar.visible {
  opacity: 1;
  pointer-events: all;
  transform: translateY(0);
}

.chapter-title {
  flex: 1;
  text-align: center;
  font-size: 14px;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 12px;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.reader-content {
  flex: 1;
  overflow-y: auto;
  padding: 60px 0;
}

.content-wrapper {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px;
}

.chapter-content {
  font-family: 'Noto Serif SC', serif;
  transition: font-size 0.2s ease, line-height 0.2s ease;
}

.chapter-content :deep(p) {
  margin-bottom: 1.2em;
  text-indent: 2em;
}

.progress-info {
  font-size: 13px;
  color: var(--text-2);
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 8px 0;
}

.setting-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.setting-label {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 500;
}

.theme-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-btn {
  padding: 10px;
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-family: var(--font-sans);
  transition: all 0.2s ease;
}

.theme-btn.active {
  border-color: var(--accent);
}

.chapter-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.chapter-item {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-1);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chapter-item:hover {
  background: rgba(124, 92, 255, 0.1);
  color: var(--text-0);
}

.chapter-item.active {
  background: rgba(124, 92, 255, 0.2);
  color: var(--accent);
  font-weight: 500;
}

.content-loading {
  padding: 20px 0;
}
</style>
