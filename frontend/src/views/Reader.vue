<template>
  <div class="reader-page" :style="readerStyle">

    <!-- ── PDF 原生渲染模式 ── -->
    <template v-if="isPdf">
      <div class="pdf-topbar">
        <el-button :icon="ArrowLeft" circle title="返回" @click="router.back()" />
        <span class="pdf-topbar-title">PDF 阅读</span>
      </div>
      <div class="pdf-viewer-area">
        <div v-if="pdfLoading" class="pdf-loading">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在加载 PDF…</span>
        </div>
        <iframe
          v-else-if="pdfBlobUrl"
          :src="pdfBlobUrl"
          class="pdf-frame"
          allowfullscreen
        />
        <div v-else class="pdf-error">PDF 加载失败，请检查文件是否完整</div>
      </div>
    </template>

    <!-- ── 章节阅读模式 ── -->
    <template v-else>
    <!-- Toolbar Top -->
    <div class="reader-toolbar top" :class="{ visible: toolbarVisible }">
      <el-button :icon="ArrowLeft" circle title="返回" @click="router.back()" />
      <span class="chapter-title">{{ currentChapter ? (currentChapter.title || `第 ${currentChapter.index + 1} 页`) : '加载中...' }}</span>
      <div class="toolbar-actions">
        <el-button :icon="Bookmark" circle title="书签" @click="bookmarkDrawerVisible = true" />
        <el-button :icon="Setting" circle title="阅读设置" @click="settingsPanelVisible = true" />
        <el-button :icon="List" circle title="章节目录" @click="chapterListVisible = true" />
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
            @click.capture="handleContentClick"
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
            <div class="chapter-content" v-html="ch.content" :style="contentStyle" @click.capture="handleContentClick" />
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

    <!-- Bookmark FAB -->
    <div class="bookmark-fab" title="添加书签 (B)" @click.stop="handleAddBookmark">
      <el-icon><Bookmark /></el-icon>
      <span class="fab-hotkey">B</span>
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
      @open="scrollChapterListToActive"
    >
      <div class="chapter-list" ref="chapterListRef">
        <div
          v-for="ch in reader.chapters.value"
          :key="ch.index"
          class="chapter-item"
          :class="{ active: ch.index === reader.currentChapterIndex.value }"
          @click="jumpToChapter(ch.index)"
        >
          {{ ch.title || `第 ${ch.index + 1} 页` }}
        </div>
      </div>
    </el-drawer>

    <!-- Bookmark Drawer -->
    <el-drawer
      v-model="bookmarkDrawerVisible"
      title="书签"
      direction="ltr"
      size="280px"
    >
      <div class="bookmark-panel">
        <el-button type="primary" size="small" style="width:100%;margin-bottom:12px" @click="handleAddBookmark">
          + 添加当前位置
        </el-button>
        <div v-if="reader.bookmarks.value.length === 0" class="bookmark-empty">
          暂无书签
        </div>
        <div v-else class="bookmark-list">
          <div v-for="bm in reader.bookmarks.value" :key="bm.id" class="bookmark-item">
            <div class="bookmark-info" @click="jumpToBookmark(bm.chapter_index, bm.scroll_top)">
              <div class="bookmark-chapter">{{ reader.chapters.value[bm.chapter_index]?.title || `第 ${bm.chapter_index + 1} 章` }}</div>
              <div v-if="bm.note" class="bookmark-note">{{ bm.note }}</div>
              <div class="bookmark-time">{{ new Date(bm.created_at).toLocaleString() }}</div>
            </div>
            <el-button :icon="Delete" circle size="small" text @click="reader.deleteBookmark(bm.id)" />
          </div>
        </div>
      </div>
    </el-drawer>

    </template><!-- end 章节模式 -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, onUnmounted, watchEffect, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, ArrowRight, Star, Setting, List, Loading, Delete } from '@element-plus/icons-vue'
const Bookmark = Star
import { useReader } from '@/composables/useReader'
import { useReaderStore } from '@/stores/reader'
import { readerApi } from '@/api/reader'
import type { ReaderTheme } from '@/types'

const route = useRoute()
const router = useRouter()
const readerStore = useReaderStore()
const bookId = route.params.bookId as string

const reader = useReader(bookId)
const loading = computed(() => reader.loading.value)
const contentRef = ref<HTMLElement | null>(null)
const chapterListRef = ref<HTMLElement | null>(null)
const toolbarVisible = ref(true)
const settingsPanelVisible = ref(false)
const chapterListVisible = ref(false)
const bookmarkDrawerVisible = ref(false)

// ── PDF native rendering ─────────────────────────────────────
// isPdf: true 表示使用浏览器原生 iframe 打开（插件未启用时的默认行为）
const isPdf = computed(() => reader.bookFormat.value === 'pdf' && !reader.pdfUsePlugin.value)
const pdfBlobUrl = ref('')
const pdfLoading = ref(false)

async function loadPdfBlob() {
  pdfLoading.value = true
  try {
    const resp = await readerApi.getRaw(bookId)
    const blob = new Blob([resp.data as ArrayBuffer], { type: 'application/pdf' })
    pdfBlobUrl.value = URL.createObjectURL(blob)
  } finally {
    pdfLoading.value = false
  }
}

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

// If chapter content is shorter than the viewport, the scroll event never fires
// and the next chapter never auto-loads. Keep appending chapters until the
// container is tall enough to be scrollable (with a 300px trigger margin).
async function fillWaterfallIfNeeded() {
  await nextTick()
  await new Promise<void>(r => requestAnimationFrame(() => r()))
  const container = contentRef.value
  if (!container) return
  while (hasMoreChapters.value && !waterfallLoading.value) {
    if (container.scrollHeight > container.clientHeight + 300) break
    const nextIndex = waterfallChapters.value[waterfallChapters.value.length - 1].index + 1
    await loadWaterfallChapter(nextIndex)
    await nextTick()
    await new Promise<void>(r => requestAnimationFrame(() => r()))
  }
}

async function initWaterfall() {
  waterfallChapters.value = []
  const startIndex = reader.currentChapterIndex.value
  await loadWaterfallChapter(startIndex)
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
  requestAnimationFrame(() => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  })
  await fillWaterfallIfNeeded()
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
    loadWaterfallChapter(nextIndex).then(() => fillWaterfallIfNeeded())
  }
}

// ── EPUB internal link interception ─────────────────────────
// Build a map from href basename to chapter index for EPUB link navigation.
// EPUB internal links look like "part0004.html" or "text/part0004.html".
// We normalise to just the filename to handle both forms.
function buildHrefIndexMap(): Map<string, number> {
  const map = new Map<string, number>()
  for (const ch of reader.chapters.value) {
    if (ch.href) {
      map.set(ch.href, ch.index)
      // Also index by basename only (strip directory prefix)
      const base = ch.href.split('/').pop()
      if (base && base !== ch.href) map.set(base, ch.index)
    }
  }
  return map
}

function handleContentClick(e: MouseEvent) {
  const target = (e.target as HTMLElement).closest('a')
  if (!target) return
  const href = target.getAttribute('href')
  if (!href) return
  // Allow external links to open normally
  if (/^https?:\/\//i.test(href)) return
  // Strip anchor to get the file path
  const hrefBase = href.split('#')[0]
  if (!hrefBase) return
  e.preventDefault()
  e.stopPropagation()
  const hrefMap = buildHrefIndexMap()
  // Try full path first, then basename
  const base = hrefBase.split('/').pop() || hrefBase
  const idx = hrefMap.get(hrefBase) ?? hrefMap.get(base)
  if (idx !== undefined) {
    jumpToChapter(idx)
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
    await fillWaterfallIfNeeded()
  } else {
    await reader.loadChapter(index)
    await reader.saveProgress(0)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

async function handleAddBookmark() {
  await reader.addBookmark(contentRef.value?.scrollTop || 0)
}

async function jumpToBookmark(chapterIndex: number, scrollTop: number) {
  bookmarkDrawerVisible.value = false
  if (readerStore.settings.pageMode === 'waterfall') {
    reader.currentChapterIndex.value = chapterIndex
    waterfallChapters.value = []
    await loadWaterfallChapter(chapterIndex)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
    return
  }
  // 不同章节才重新加载；同章节只需滚动，跳过会导致 scrollTop 归零的 loading 切换
  if (chapterIndex !== reader.currentChapterIndex.value) {
    await reader.loadChapter(chapterIndex)
  }
  await nextTick()
  // 等待网络字体渲染完成，否则字体换行导致布局偏移后 scrollTop 失效
  await document.fonts.ready
  const el = contentRef.value
  if (!el) return
  // 读取 scrollHeight 强制同步 layout，再赋值
  void el.scrollHeight
  el.scrollTop = scrollTop
  // 再补一帧兜底（字体 fallback 可能还有一次 reflow）
  requestAnimationFrame(() => {
    el.scrollTop = scrollTop
  })
}

function scrollChapterListToActive() {
  nextTick(() => {
    const active = chapterListRef.value?.querySelector<HTMLElement>('.chapter-item.active')
    active?.scrollIntoView({ block: 'center', behavior: 'instant' })
  })
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
function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.key === 'b' || e.key === 'B') handleAddBookmark()
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  await readerStore.loadPrefs()
  await reader.loadChapters()

  if (isPdf.value) {
    await loadPdfBlob()
    return
  }

  await reader.loadProgress()
  reader.loadBookmarks()

  if (readerStore.settings.pageMode === 'waterfall') {
    await initWaterfall()
  } else {
    await reader.loadChapter(reader.progress.value.chapterIndex)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
    requestAnimationFrame(() => {
      if (contentRef.value) contentRef.value.scrollTop = 0
    })
  }
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  if (!isPdf.value && !reader.loading.value) {
    reader.saveProgress(0)
  }
})

onUnmounted(() => {
  clearTimeout(toolbarTimer)
  window.removeEventListener('keydown', handleKeydown)
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
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

/* ── Bookmark panel ── */
.bookmark-panel { display: flex; flex-direction: column; }
.bookmark-empty { text-align: center; color: var(--text-2); font-size: 13px; padding: 32px 0; }
.bookmark-list { display: flex; flex-direction: column; gap: 4px; }
.bookmark-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  transition: background 0.15s;
}
.bookmark-item:hover { background: rgba(124,92,255,0.08); }
.bookmark-info { flex: 1; cursor: pointer; overflow: hidden; }
.bookmark-chapter { font-size: 14px; color: var(--text-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bookmark-note { font-size: 12px; color: var(--text-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bookmark-time { font-size: 11px; color: var(--text-2); margin-top: 2px; opacity: 0.7; }
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

/* ── PDF viewer ── */
.pdf-topbar {
  position: fixed;
  top: 0; left: 0; right: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(11, 16, 32, 0.92);
  backdrop-filter: blur(12px);
}

.pdf-topbar-title {
  font-size: 14px;
  color: var(--text-1);
}

.pdf-viewer-area {
  position: fixed;
  inset: 0;
  padding-top: 48px; /* below topbar */
  display: flex;
  align-items: center;
  justify-content: center;
  background: #525659;
}

.pdf-frame {
  width: 100%;
  height: 100%;
  border: none;
}

.pdf-loading,
.pdf-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: #ccc;
  font-size: 15px;
}

.pdf-loading .el-icon {
  font-size: 32px;
}

/* ── Bookmark FAB ── */
.bookmark-fab {
  position: fixed;
  right: 18px;
  bottom: 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 9px;
  background: rgba(11, 16, 32, 0.7);
  border: 1px solid rgba(124, 92, 255, 0.35);
  border-radius: 24px;
  cursor: pointer;
  z-index: 90;
  color: var(--accent);
  font-size: 18px;
  opacity: 0.55;
  backdrop-filter: blur(8px);
  transition: opacity 0.2s, background 0.2s;
  user-select: none;
}
.bookmark-fab:hover {
  opacity: 1;
  background: rgba(124, 92, 255, 0.2);
}
.fab-hotkey {
  font-size: 10px;
  font-family: monospace;
  color: var(--text-2);
  line-height: 1;
}
</style>
