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
      <!-- ── 章节模式 ── -->
      <template v-if="readerStore.settings.pageMode === 'scroll'">
        <div class="content-wrapper" :style="wrapperStyle">
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
      </template>

      <!-- ── 瀑布流模式 ── -->
      <template v-else>
        <div class="content-wrapper" :style="wrapperStyle">
          <div
            v-for="ch in waterfallChapters"
            :key="ch.index"
            :data-chapter-index="ch.index"
            class="waterfall-chapter"
          >
            <div class="waterfall-chapter-divider">
              <span>{{ ch.title }}</span>
            </div>
            <div class="chapter-content" v-html="ch.content" :style="contentStyle" />
          </div>
          <div v-if="waterfallLoading" class="waterfall-loading">
            <el-icon class="is-loading"><Loading /></el-icon> 加载中…
          </div>
          <div v-else-if="!hasMoreChapters && waterfallChapters.length > 0" class="waterfall-end">
            — 本书完 —
          </div>
        </div>
      </template>
    </div>

    <!-- Toolbar Bottom -->
    <div class="reader-toolbar bottom" :class="{ visible: toolbarVisible }">
      <template v-if="readerStore.settings.pageMode === 'scroll'">
        <el-button :icon="ArrowLeft" :disabled="reader.currentChapterIndex.value === 0" @click="goToPrevChapter">上一章</el-button>
        <div class="progress-info">
          {{ reader.currentChapterIndex.value + 1 }} / {{ reader.chapters.value.length }}
        </div>
        <el-button :icon="ArrowRight" :disabled="reader.currentChapterIndex.value >= reader.chapters.value.length - 1" @click="goToNextChapter">下一章</el-button>
      </template>
      <template v-else>
        <div class="progress-info">
          {{ reader.currentChapterIndex.value + 1 }} / {{ reader.chapters.value.length }} 章 · 瀑布流
        </div>
      </template>
    </div>

    <!-- Settings Panel -->
    <el-drawer
      v-model="settingsPanelVisible"
      title="阅读设置"
      direction="rtl"
      size="340px"
      :modal-class="'reader-drawer'"
    >
      <div class="settings-panel">
        <!-- 阅读模式 -->
        <div class="setting-group">
          <div class="setting-label">阅读模式</div>
          <div class="mode-options">
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.pageMode === 'scroll' }"
              @click="setPageMode('scroll')"
            >章节翻页</button>
            <button
              class="mode-btn"
              :class="{ active: readerStore.settings.pageMode === 'waterfall' }"
              @click="setPageMode('waterfall')"
            >瀑布流</button>
          </div>
        </div>

        <!-- 主题 -->
        <div class="setting-group">
          <div class="setting-label">主题</div>
          <div class="theme-options">
            <button
              v-for="(val, key) in readerStore.themes"
              :key="key"
              class="theme-btn"
              :class="{ active: readerStore.settings.theme === key }"
              :style="{ background: val.backgroundColor, color: val.fontColor, border: '2px solid ' + (readerStore.settings.theme === key ? 'var(--accent)' : 'rgba(128,128,128,0.3)') }"
              @click="readerStore.applyTheme(key as ReaderTheme)"
            >{{ val.label }}</button>
          </div>
        </div>

        <!-- 字号 -->
        <div class="setting-group">
          <div class="setting-label">字号 {{ readerStore.settings.fontSize }}px</div>
          <el-slider v-model="readerStore.settings.fontSize" :min="12" :max="32" @change="saveSettings" />
        </div>

        <!-- 行高 -->
        <div class="setting-group">
          <div class="setting-label">行高 {{ readerStore.settings.lineHeight }}</div>
          <el-slider v-model="readerStore.settings.lineHeight" :min="1.4" :max="2.5" :step="0.1" @change="saveSettings" />
        </div>

        <!-- 页面宽度 -->
        <div class="setting-group">
          <div class="setting-label">页面宽度 {{ readerStore.settings.pageWidth }}%</div>
          <el-slider v-model="readerStore.settings.pageWidth" :min="20" :max="98" :step="2" @change="saveSettings" />
        </div>

        <!-- 字体 -->
        <div class="setting-group">
          <div class="setting-label">字体</div>
          <el-select v-model="readerStore.settings.fontFamily" @change="saveSettings" style="width:100%">
            <el-option
              v-for="f in readerStore.fontOptions"
              :key="f.value"
              :label="f.label"
              :value="f.value"
            />
          </el-select>
        </div>

        <!-- 重置 -->
        <el-button size="small" @click="readerStore.resetSettings()" style="margin-top:8px">恢复默认</el-button>
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
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watchEffect, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Star, Setting, List, Loading } from '@element-plus/icons-vue'
const Bookmark = Star
import { useReader } from '@/composables/useReader'
import { useReaderStore } from '@/stores/reader'
import type { ReaderTheme } from '@/types'

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

// ── Computed styles ──────────────────────────────────────────
const readerStyle = computed(() => ({
  backgroundColor: readerStore.settings.backgroundColor,
  color: readerStore.settings.fontColor,
}))

const wrapperStyle = computed(() => ({
  width: `${readerStore.settings.pageWidth}%`,
}))

const contentStyle = computed(() => ({
  fontFamily: readerStore.settings.fontFamily,
  fontSize: `${readerStore.settings.fontSize}px`,
  lineHeight: readerStore.settings.lineHeight,
  letterSpacing: `${readerStore.settings.letterSpacing}px`,
}))

const currentChapter = computed(() => reader.currentChapter.value)

// ── Waterfall state ──────────────────────────────────────────
interface WaterfallChapter { index: number; title: string; content: string }
const waterfallChapters = ref<WaterfallChapter[]>([])
const waterfallLoading = ref(false)
const hasMoreChapters = computed(() => {
  if (!waterfallChapters.value.length) return false
  return waterfallChapters.value[waterfallChapters.value.length - 1].index < reader.chapters.value.length - 1
})

async function loadWaterfallChapter(index: number) {
  if (waterfallLoading.value) return
  if (index >= reader.chapters.value.length) return
  waterfallLoading.value = true
  try {
    const content = await reader.fetchChapterContent(index)
    waterfallChapters.value.push({
      index,
      title: reader.chapters.value[index]?.title || `第 ${index + 1} 章`,
      content,
    })
  } finally {
    waterfallLoading.value = false
  }
}

async function initWaterfall() {
  waterfallChapters.value = []
  const startIndex = reader.currentChapterIndex.value
  await loadWaterfallChapter(startIndex)
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
  // Belt-and-suspenders: also reset after a frame in case fonts/transitions shift layout
  requestAnimationFrame(() => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  })
}

// ── Toolbar auto-hide ────────────────────────────────────────
function toggleToolbar() {
  toolbarVisible.value = !toolbarVisible.value
}

let toolbarTimer: ReturnType<typeof setTimeout>
watchEffect(() => {
  if (toolbarVisible.value) {
    clearTimeout(toolbarTimer)
    toolbarTimer = setTimeout(() => { toolbarVisible.value = false }, 4000)
  }
})

// ── Scroll handler ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout>

function handleScroll() {
  if (!contentRef.value) return
  const scrollTop = contentRef.value.scrollTop

  if (readerStore.settings.pageMode === 'waterfall') {
    handleWaterfallScroll(scrollTop)
  } else {
    // Debounce-save chapter index only (scrollTop always 0 — restore to beginning)
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      reader.saveProgress(0)
    }, 2000)
  }
}

function handleWaterfallScroll(scrollTop: number) {
  const container = contentRef.value!
  const chapterEls = container.querySelectorAll<HTMLElement>('[data-chapter-index]')
  const viewportMid = scrollTop + container.clientHeight / 2
  let visibleIdx = reader.currentChapterIndex.value
  for (const el of chapterEls) {
    if (el.offsetTop <= viewportMid) {
      visibleIdx = parseInt(el.getAttribute('data-chapter-index') || '0')
    }
  }

  // When entering a new chapter, immediately save (chapterIdx, scrollTop=0).
  // This ensures exit-right-after-chapter-entry always restores to chapter beginning.
  if (visibleIdx !== reader.currentChapterIndex.value) {
    reader.currentChapterIndex.value = visibleIdx
    reader.saveProgress(0)  // fire-and-forget
  }

  // Auto-load next chapter when near bottom
  const nearBottom = scrollTop + container.clientHeight >= container.scrollHeight - 300
  if (nearBottom && hasMoreChapters.value && !waterfallLoading.value) {
    const nextIndex = waterfallChapters.value[waterfallChapters.value.length - 1].index + 1
    loadWaterfallChapter(nextIndex)
  }
}

// ── Chapter navigation (scroll mode) ────────────────────────
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
  if (readerStore.settings.pageMode === 'waterfall') {
    // In waterfall, reset to the selected chapter
    reader.currentChapterIndex.value = index
    waterfallChapters.value = []
    await loadWaterfallChapter(index)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  } else {
    await reader.loadChapter(index)
    await reader.saveProgress(0)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

async function addBookmarkQuick() {
  await reader.addBookmark(contentRef.value?.scrollTop || 0)
}

// ── Settings ─────────────────────────────────────────────────
function saveSettings() {
  readerStore.updateSettings(readerStore.settings)
}

async function setPageMode(mode: 'scroll' | 'waterfall') {
  readerStore.updateSettings({ pageMode: mode })
  if (mode === 'waterfall') {
    await initWaterfall()
  } else {
    // Reload current chapter in scroll mode
    await reader.loadChapter(reader.currentChapterIndex.value)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

// ── Lifecycle ────────────────────────────────────────────────
onMounted(async () => {
  await readerStore.loadPrefs()
  await reader.loadChapters()
  await reader.loadProgress()

  if (readerStore.settings.pageMode === 'waterfall') {
    await initWaterfall()
  } else {
    await reader.loadChapter(reader.progress.value.chapterIndex)
    // Always start at chapter beginning
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
    // Belt-and-suspenders: reset again after a frame to counter font/transition layout shifts
    requestAnimationFrame(() => {
      if (contentRef.value) contentRef.value.scrollTop = 0
    })
  }
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  if (!reader.loading.value) {
    reader.saveProgress(0)
  }
})

onUnmounted(() => {
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
  background: rgba(11, 16, 32, 0.88);
  backdrop-filter: blur(12px);
  z-index: 100;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.reader-toolbar.top    { top: 0;    transform: translateY(-100%); }
.reader-toolbar.bottom { bottom: 0; transform: translateY(100%); }
.reader-toolbar.visible { opacity: 1; pointer-events: all; transform: translateY(0); }

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
.toolbar-actions { display: flex; gap: 8px; }

.reader-content {
  flex: 1;
  overflow-y: auto;
  padding: 60px 0;
  overflow-anchor: none;
}

.content-wrapper {
  margin: 0 auto;
  padding: 32px 24px;
  transition: width 0.2s ease;
}

.chapter-content {
  transition: font-size 0.2s ease, line-height 0.2s ease;
}
.chapter-content :deep(p) {
  margin-bottom: 1.2em;
  text-indent: 2em;
}

/* ── Waterfall ── */
.waterfall-chapter { margin-bottom: 8px; }
.waterfall-chapter-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 40px 0 24px;
  color: v-bind('readerStore.settings.fontColor');
  opacity: 0.5;
  font-size: 13px;
}
.waterfall-chapter-divider::before,
.waterfall-chapter-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: currentColor;
}
.waterfall-loading,
.waterfall-end {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  opacity: 0.5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* ── Settings panel ── */
.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0;
}
.setting-group { display: flex; flex-direction: column; gap: 10px; }
.setting-label { font-size: 13px; color: var(--text-2); font-weight: 500; }

.mode-options { display: flex; gap: 8px; }
.mode-btn {
  flex: 1;
  padding: 8px;
  border-radius: var(--radius-md);
  border: 2px solid rgba(128,128,128,0.2);
  cursor: pointer;
  font-size: 13px;
  background: transparent;
  color: var(--text-1);
  transition: all 0.2s ease;
}
.mode-btn.active { border-color: var(--accent); color: var(--accent); }

.theme-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.theme-btn {
  padding: 8px 4px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 12px;
  font-family: var(--font-sans);
  transition: all 0.2s ease;
  text-align: center;
}

/* ── Progress & chapter list ── */
.progress-info { font-size: 13px; color: var(--text-2); }

.chapter-list { display: flex; flex-direction: column; gap: 2px; }
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
.chapter-item:hover { background: rgba(124,92,255,0.1); color: var(--text-0); }
.chapter-item.active { background: rgba(124,92,255,0.2); color: var(--accent); font-weight: 500; }

.content-loading { padding: 20px 0; }
</style>
