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

    <!-- ── 章节阅读模式（样式见 docs/reader-style-spec.md）── -->
    <template v-else>
    <!-- 外围底色 + 居中「纸张」；顶部导航吸顶，下滑隐藏、上滑显示 -->
    <div
      class="reader-content"
      ref="contentRef"
      @click="toggleToolbar"
      @scroll="handleScroll"
    >
      <div class="paper" :class="{ 'pdf-wrapper': isPdfRender }" :style="paperStyle">
        <header class="reader-nav" :class="{ hidden: !toolbarVisible }" @click.stop>
          <button class="nav-btn" title="返回" @click="router.back()"><IconChevronLeft :size="22" :stroke-width="1.75" /></button>
          <span class="nav-title">{{ bookTitle }}</span>
          <span class="nav-progress">
            {{ reader.currentChapterIndex.value + 1 }} / {{ reader.chapters.value.length }}{{ readerStore.settings.pageMode === 'waterfall' ? ` ${unitLabel} · 瀑布流` : '' }}
          </span>
          <!-- 窄屏：左侧工具栏放不下，按钮收在导航右侧 -->
          <div class="nav-actions">
            <button class="nav-btn" title="章节目录" data-toc-toggle @click="openToc('toc')"><IconList :size="20" :stroke-width="1.75" /></button>
            <button class="nav-btn" title="书签（按 B 添加当前位置）" data-toc-toggle @click="openToc('bookmark')"><IconBookmark :size="20" :stroke-width="1.75" /></button>
            <button class="nav-btn" title="阅读设置" @click="settingsPanelVisible = true"><IconSettings :size="20" :stroke-width="1.75" /></button>
          </div>
        </header>

        <!-- 右侧悬浮工具栏：固定在纸张右外侧、垂直居中（宽屏） -->
        <aside class="side-tools" @click.stop>
          <button class="side-tool" :class="{ on: tocVisible && tocTab === 'toc' }" title="章节目录" data-toc-toggle @click="openToc('toc')">
            <IconList :size="24" :stroke-width="1.5" /><span>目录</span>
          </button>
          <button class="side-tool" :class="{ on: tocVisible && tocTab === 'bookmark' }" title="书签（按 B 添加当前位置）" data-toc-toggle @click="openToc('bookmark')">
            <IconBookmark :size="24" :stroke-width="1.5" /><span>书签</span>
          </button>
          <button class="side-tool" title="书籍详情" @click="router.push(`/book/${bookId}`)">
            <IconBook2 :size="24" :stroke-width="1.5" /><span>书详情</span>
          </button>
          <button class="side-tool" :title="nightMode ? '切换到护眼绿' : '切换到夜间'" @click="toggleNight">
            <component :is="nightMode ? IconSun : IconMoon" :size="24" :stroke-width="1.5" /><span>{{ nightMode ? '日间' : '夜间' }}</span>
          </button>
          <button class="side-tool" title="阅读设置" @click="settingsPanelVisible = true">
            <IconSettings :size="24" :stroke-width="1.5" /><span>设置</span>
          </button>
        </aside>

        <!-- ── 章节模式 ── -->
        <template v-if="readerStore.settings.pageMode === 'scroll'">
          <div v-if="loading" class="content-loading">
            <el-skeleton :rows="20" animated />
          </div>
          <template v-else>
            <div v-if="!isPdfRender" class="chapter-head">
              <h1 class="chapter-heading">{{ chapterTitle }}</h1>
              <div class="chapter-meta">{{ chapterMeta(reader.currentContent.value) }}</div>
            </div>
            <div v-if="isPdfRender" class="chapter-content pdf-chapter">
              <PdfPage v-if="pdfDoc" :doc="pdfDoc" :page-number="reader.currentChapterIndex.value + 1" />
              <div v-else-if="pdfDocFailed" class="pdf-error">PDF 加载失败，请检查文件是否完整</div>
              <el-skeleton v-else :rows="20" animated />
            </div>
            <div
              v-else
              class="chapter-content"
              v-html="hideLeadingTitle(reader.currentContent.value, chapterTitle)"
              :style="contentStyle"
              @click.capture="handleContentClick"
            />
            <!-- 章末导航：上一章 · 目录 · 下一章 -->
            <nav class="chapter-end" @click.stop>
              <button class="end-btn" :disabled="reader.currentChapterIndex.value === 0" @click="goToPrevChapter">上一{{ unitLabel }}</button>
              <button class="end-btn" data-toc-toggle @click="openToc('toc')">目录</button>
              <button class="end-btn" :disabled="reader.currentChapterIndex.value >= reader.chapters.value.length - 1" @click="goToNextChapter">下一{{ unitLabel }}</button>
            </nav>
          </template>
        </template>

        <!-- ── 瀑布流模式：章节之间用分隔线 ── -->
        <template v-else>
          <section
            v-for="ch in waterfallChapters"
            :key="ch.index"
            :data-chapter-index="ch.index"
            class="waterfall-chapter"
          >
            <div v-if="!isPdfRender" class="chapter-head">
              <h1 class="chapter-heading">{{ ch.title }}</h1>
              <div class="chapter-meta">{{ chapterMeta(ch.content) }}</div>
            </div>
            <div v-if="isPdfRender" class="chapter-content pdf-chapter">
              <PdfPage v-if="pdfDoc" :doc="pdfDoc" :page-number="ch.index + 1" />
            </div>
            <div v-else class="chapter-content" v-html="hideLeadingTitle(ch.content, ch.title)" :style="contentStyle" @click.capture="handleContentClick" />
          </section>
          <div v-if="waterfallLoading" class="waterfall-loading">
            <el-icon class="is-loading"><Loading /></el-icon> 加载中…
          </div>
          <div v-else-if="!hasMoreChapters && waterfallChapters.length > 0" class="waterfall-end">
            — 本书完 —
          </div>
        </template>
      </div>
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
          <el-slider v-model="readerStore.settings.fontSize" :min="14" :max="30" @change="saveSettings" />
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

        <div class="shortcut-hint">快捷键：← → 翻章 · ↑ ↓ / 空格 翻屏 · B 加书签</div>
      </div>
    </el-drawer>

    <!-- 目录面板（docs/reader-toc-spec.md）：与纸张同宽、正好盖住正文区，无遮罩；点外部 / Esc 关闭 -->
    <Transition name="toc">
      <div v-if="tocVisible" class="toc-layer">
        <div class="toc-panel" ref="tocPanelRef">
          <div class="toc-head">
            <button class="toc-tab" :class="{ active: tocTab === 'toc' }" @click="switchTocTab('toc')">目录</button>
            <span v-if="tocTab === 'toc'" class="toc-status">{{ tocStatus }}</span>
            <button class="toc-tab" :class="{ active: tocTab === 'bookmark' }" @click="switchTocTab('bookmark')">书签</button>
            <div class="toc-actions">
              <button v-if="tocTab === 'toc'" class="toc-action" @click="tocReversed = !tocReversed">
                <IconArrowsSort :size="16" :stroke-width="1.75" />{{ tocReversed ? '正序' : '倒序' }}
              </button>
              <button v-else class="toc-action" @click="handleAddBookmark">
                <IconBookmarkPlus :size="16" :stroke-width="1.75" />添加当前位置
              </button>
              <!-- 窄屏面板占满屏幕、没有「外部」可点，提供关闭按钮 -->
              <button class="toc-action toc-close" title="关闭" @click="tocVisible = false"><IconX :size="18" :stroke-width="1.75" /></button>
            </div>
          </div>
          <div class="toc-body" ref="tocBodyRef">
            <ul v-if="tocTab === 'toc'" class="toc-list">
              <li v-for="ch in tocChapters" :key="ch.index">
                <a
                  class="toc-link"
                  :class="{ current: ch.index === reader.currentChapterIndex.value, read: ch.index < reader.currentChapterIndex.value }"
                  :title="ch.title || `第 ${ch.index + 1} ${unitLabel}`"
                  @click="jumpToChapter(ch.index)"
                ><span class="toc-title">{{ ch.title || `第 ${ch.index + 1} ${unitLabel}` }}</span></a>
              </li>
            </ul>
            <template v-else>
              <div v-if="reader.bookmarks.value.length === 0" class="toc-empty">还没有书签，阅读时按 B 或点右上角「添加当前位置」</div>
              <ul v-else class="toc-list">
                <li v-for="bm in reader.bookmarks.value" :key="bm.id">
                  <a class="toc-link" @click="jumpToBookmark(bm.chapter_index, bm.scroll_top)">
                    <span class="toc-title">
                      {{ reader.chapters.value[bm.chapter_index]?.title || `第 ${bm.chapter_index + 1} ${unitLabel}` }}
                      <small v-if="bm.note" class="toc-note">{{ bm.note }}</small>
                    </span>
                    <span class="toc-extra">{{ formatServerTime(bm.created_at) }}</span>
                    <button class="toc-del" title="删除书签" @click.stop="reader.deleteBookmark(bm.id)"><IconTrash :size="16" :stroke-width="1.75" /></button>
                  </a>
                </li>
              </ul>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    </template><!-- end 章节模式 -->
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, onUnmounted, nextTick } from 'vue'
import { formatServerTime } from '@/utils/time'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Loading } from '@element-plus/icons-vue'
import { useReader } from '@/composables/useReader'
import { useReaderStore } from '@/stores/reader'
import { readerApi } from '@/api/reader'
import type { PDFDocumentProxy } from '@/utils/pdf'
import PdfPage from '@/components/PdfPage.vue'
import type { ReaderTheme, ReadingAnchor } from '@/types'
import { readerKeyAction, pageScrollDistance, alignedPageDistance } from '@/utils/reader-keys'
import { readerPalette, hideLeadingTitle, countChapterChars, isDarkReaderTheme, nightToggleTheme } from '@/utils/reader-style'
import { libraryApi } from '@/api/library'
import { IconArrowsSort, IconBook2, IconBookmark, IconBookmarkPlus, IconChevronLeft, IconList, IconMoon, IconSettings, IconSun, IconTrash, IconX } from '@tabler/icons-vue'

const route = useRoute()
const router = useRouter()
const readerStore = useReaderStore()
const bookId = route.params.bookId as string

const reader = useReader(bookId)
const loading = computed(() => reader.loading.value)
const contentRef = ref<HTMLElement | null>(null)
const toolbarVisible = ref(true)
const settingsPanelVisible = ref(false)

// ── 目录面板 ─────────────────────────────────────────────────
const tocVisible = ref(false)
const tocTab = ref<'toc' | 'bookmark'>('toc')
const tocReversed = ref(false)
const tocPanelRef = ref<HTMLElement | null>(null)
const tocBodyRef = ref<HTMLElement | null>(null)
let tocClosedAt = 0

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

// ── PDF 逐页渲染（插件模式）────────────────────────────────
// 每页作为一章，沿用章节翻页 / 瀑布流 / 进度 / 书签；正文用 pdf.js 按原版画出，保留图片与版式
const isPdfRender = computed(() => reader.bookFormat.value === 'pdf' && reader.pdfUsePlugin.value)
const unitLabel = computed(() => isPdfRender.value ? '页' : '章')

// 标题区：章节标题 + 元信息（书名 · 作者 · 本章字数）
const bookTitle = ref('')
const bookAuthor = ref('')
const bookFinished = ref(false)
const chapterTitle = computed(() => {
  const ch = reader.currentChapter.value
  return ch ? (ch.title || `第 ${ch.index + 1} ${unitLabel.value}`) : ''
})
function chapterMeta(html: string): string {
  return [bookTitle.value, bookAuthor.value, `本章 ${countChapterChars(html)} 字`].filter(Boolean).join(' · ')
}
async function loadBookInfo() {
  try {
    const b = (await libraryApi.get(bookId)).data.data
    bookTitle.value = b?.display_title || b?.title || ''
    bookAuthor.value = b?.author || ''
    bookFinished.value = !!b?.is_finished
  } catch { /* 标题区仅作展示，失败不影响阅读 */ }
}
const pdfDoc = shallowRef<PDFDocumentProxy | null>(null)
const pdfDocFailed = ref(false)

async function loadPdfDocument() {
  try {
    // pdf.js 体积较大，只在打开 PDF 时按需加载，不影响其他格式的阅读页
    const [resp, { openPdfDocument }] = await Promise.all([readerApi.getRaw(bookId), import('@/utils/pdf')])
    pdfDoc.value = await openPdfDocument(resp.data as ArrayBuffer)
  } catch (err) {
    console.error('[pdf] load document failed', err)
    pdfDocFailed.value = true
  }
}

// ── Computed styles ──────────────────────────────────────────
// 阅读配色以 CSS 变量提供（--reader-page-bg / --reader-paper-bg / --reader-text …），便于切换阅读主题
const readerStyle = computed(() => ({
  // 纸张宽度：「页面宽度」百分比，最宽 1280px，并给右侧工具栏留出位置；目录面板与工具栏定位共用
  '--paper-w': `min(${readerStore.settings.pageWidth}%, 1280px, calc(100% - 176px))`,
  ...readerPalette(readerStore.settings.theme, readerStore.settings.backgroundColor, readerStore.settings.fontColor),
  color: 'var(--reader-text)',
}))

const paperStyle = computed(() => ({
  width: 'var(--paper-w)',
  '--reader-font': readerStore.settings.fontFamily,
}))

const contentStyle = computed(() => ({
  fontFamily: readerStore.settings.fontFamily,
  fontSize: `${readerStore.settings.fontSize}px`,
  lineHeight: readerStore.settings.lineHeight,
  letterSpacing: `${readerStore.settings.letterSpacing}px`,
}))

// ── Waterfall state ──────────────────────────────────────────
interface WaterfallChapter { index: number; title: string; content: string }
const waterfallChapters = ref<WaterfallChapter[]>([])
const waterfallLoading = ref(false)
const hasMoreChapters = computed(() => {
  if (!waterfallChapters.value.length) return false
  return waterfallChapters.value[waterfallChapters.value.length - 1].index < reader.chapters.value.length - 1
})

// 瀑布流最多保留的章节数：超出后移除当前阅读位置之前的章节，避免 DOM 无限增长
const WATERFALL_MAX_CHAPTERS = 8

async function trimWaterfallTop() {
  const container = contentRef.value
  if (!container) return
  const excess = waterfallChapters.value.length - WATERFALL_MAX_CHAPTERS
  if (excess <= 0) return
  // 章节按顺序排列，只移除位于当前阅读章节之前的部分
  const removable = waterfallChapters.value
    .slice(0, excess)
    .filter(ch => ch.index < reader.currentChapterIndex.value).length
  if (removable === 0) return

  // 以保留下来的第一章为锚点，比较移除前后它在视口中的位置并修正滚动，
  // 无论浏览器是否已做滚动锚定（overflow-anchor）都不会重复补偿
  const anchorIndex = waterfallChapters.value[removable].index
  const anchorEl = container.querySelector<HTMLElement>(`[data-chapter-index="${anchorIndex}"]`)
  const before = anchorEl?.getBoundingClientRect().top ?? 0
  waterfallChapters.value.splice(0, removable)
  await nextTick()
  const after = anchorEl?.getBoundingClientRect().top ?? 0
  container.scrollTop += after - before
}

// 瀑布流「代数」：每次重置（初始化 / 跳章 / 跳书签）递增，进行中的旧请求返回后据此丢弃，
// 避免后台预加载的旧章节被插进刚清空的列表、导致跳到错误章节
let waterfallGeneration = 0

function resetWaterfall() {
  waterfallGeneration++
  waterfallChapters.value = []
  waterfallLoading.value = false  // 释放旧请求持有的加载锁，让新的加载立即开始
}

async function loadWaterfallChapter(index: number) {
  if (waterfallLoading.value) return
  if (index >= reader.chapters.value.length) return
  const generation = waterfallGeneration
  waterfallLoading.value = true
  try {
    const content = await reader.fetchChapterContent(index)
    if (generation !== waterfallGeneration) return
    waterfallChapters.value.push({
      index,
      title: reader.chapters.value[index]?.title || `第 ${index + 1} 章`,
      content,
    })
  } finally {
    if (generation === waterfallGeneration) waterfallLoading.value = false
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
  resetWaterfall()
  const startIndex = reader.currentChapterIndex.value
  await loadWaterfallChapter(startIndex)
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
  requestAnimationFrame(() => {
    if (contentRef.value) contentRef.value.scrollTop = 0
  })
  await fillWaterfallIfNeeded()
}

// ── 顶部导航显隐：下滑隐藏、上滑显示，回到顶部时总是显示；点击正文切换 ──
function toggleToolbar() {
  // 点面板外部关闭目录时，同一次点击不再切换导航
  if (Date.now() - tocClosedAt < 400) return
  toolbarVisible.value = !toolbarVisible.value
}

let lastScrollTop = 0
let keyPagingUntil = 0  // 方向键翻屏期间不弹出导航，避免盖住衔接的行
function updateToolbarOnScroll(scrollTop: number) {
  const delta = scrollTop - lastScrollTop
  lastScrollTop = scrollTop
  if (Date.now() < keyPagingUntil) return
  if (scrollTop < 64) toolbarVisible.value = true
  else if (delta > 6) toolbarVisible.value = false
  else if (delta < -6) toolbarVisible.value = true
}

// ── Scroll handler ───────────────────────────────────────────
let saveTimer: ReturnType<typeof setTimeout>
let scrollRaf = 0

// ── 章节模式：章内阅读位置 ──────────────────────────────────
// 以「屏幕顶部所在段落的序号 + 该段落已读过的比例」记录位置，与字号、页面宽度、
// 设备无关，也不受网页字体晚加载导致的重排影响（像素 scrollTop 做不到这点）
const ANCHOR_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, img, figure, table'
const SAVE_DELAY_MS = 1000
const RESTORE_WINDOW_MS = 3000
let restoringPosition = false
let stopRestore: (() => void) | null = null

function getAnchorBlocks(): HTMLElement[] {
  const content = contentRef.value?.querySelector<HTMLElement>('.chapter-content')
  if (!content) return []
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(ANCHOR_SELECTOR))
  return blocks.length > 0 ? blocks : [content]
}

function getCurrentAnchor(): ReadingAnchor {
  const container = contentRef.value
  const blocks = getAnchorBlocks()
  if (!container || blocks.length === 0) return { paragraphIndex: 0, paragraphOffset: 0 }
  const viewTop = container.getBoundingClientRect().top
  for (let i = 0; i < blocks.length; i++) {
    const rect = blocks[i].getBoundingClientRect()
    if (rect.bottom > viewTop) {
      const offset = rect.height > 0 ? (viewTop - rect.top) / rect.height : 0
      return { paragraphIndex: i, paragraphOffset: Math.min(1, Math.max(0, offset)) }
    }
  }
  return { paragraphIndex: blocks.length - 1, paragraphOffset: 1 }
}

function scrollToAnchor(anchor: ReadingAnchor) {
  const container = contentRef.value
  const blocks = getAnchorBlocks()
  if (!container || blocks.length === 0) return
  const block = blocks[Math.min(anchor.paragraphIndex, blocks.length - 1)]
  const rect = block.getBoundingClientRect()
  container.scrollTop += rect.top + rect.height * anchor.paragraphOffset - container.getBoundingClientRect().top
}

async function restoreChapterPosition(anchor: ReadingAnchor) {
  stopRestore?.()
  const container = contentRef.value
  if (!container) return
  container.scrollTop = 0
  if (anchor.paragraphIndex <= 0 && anchor.paragraphOffset <= 0) return

  // 恢复期间忽略滚动事件，避免把恢复过程中的中间位置保存下来
  restoringPosition = true
  const observer = new ResizeObserver(() => scrollToAnchor(anchor))
  const userEvents = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = () => {
    observer.disconnect()
    clearTimeout(timer)
    userEvents.forEach(e => window.removeEventListener(e, stop))
    restoringPosition = false
    if (stopRestore === stop) stopRestore = null
  }
  stopRestore = stop
  // 用户一旦主动操作就停止自动定位
  userEvents.forEach(e => window.addEventListener(e, stop, { passive: true }))

  await nextTick()
  await document.fonts.ready  // 网页字体加载完成后再定位，否则重排会使位置偏移
  if (stopRestore !== stop) return
  scrollToAnchor(anchor)
  // 图片等内容晚加载会改变布局：一段时间内随正文尺寸变化重新定位
  const content = contentRef.value?.querySelector('.chapter-content')
  if (content) observer.observe(content)
  timer = setTimeout(stop, RESTORE_WINDOW_MS)
}

function saveChapterPosition(onHide = false) {
  if (!contentRef.value || reader.loading.value || restoringPosition) return
  const anchor = getCurrentAnchor()
  if (onHide) reader.saveProgressOnHide(contentRef.value.scrollTop, anchor)
  else reader.saveProgress(contentRef.value.scrollTop, anchor)
}

// 切换章节前调用：取消尚未执行的保存与正在进行的位置恢复
function resetChapterPositionTracking() {
  clearTimeout(saveTimer)
  stopRestore?.()
}

function handleVisibilityChange() {
  if (document.visibilityState !== 'hidden') return
  if (isPdf.value || readerStore.settings.pageMode !== 'scroll') return
  clearTimeout(saveTimer)
  saveChapterPosition(true)
}

function handleScroll() {
  if (!contentRef.value) return
  if (!restoringPosition) updateToolbarOnScroll(contentRef.value.scrollTop)

  if (readerStore.settings.pageMode === 'waterfall') {
    // 每帧最多处理一次，避免每个 scroll 事件都遍历章节 DOM
    if (scrollRaf) return
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0
      if (contentRef.value) handleWaterfallScroll(contentRef.value.scrollTop)
    })
  } else {
    if (restoringPosition || reader.loading.value) return
    // 延迟保存，并绑定滚动时所在的章节：期间若已切换章节则放弃，避免把旧位置记到新章节上
    const chapterAtScroll = reader.currentChapterIndex.value
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (chapterAtScroll === reader.currentChapterIndex.value) saveChapterPosition()
    }, SAVE_DELAY_MS)
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
    loadWaterfallChapter(nextIndex).then(trimWaterfallTop).then(() => fillWaterfallIfNeeded())
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
  resetChapterPositionTracking()
  await reader.prevChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function goToNextChapter() {
  resetChapterPositionTracking()
  await reader.nextChapter()
  await nextTick()
  if (contentRef.value) contentRef.value.scrollTop = 0
}

async function jumpToChapter(index: number) {
  tocVisible.value = false
  resetChapterPositionTracking()
  if (readerStore.settings.pageMode === 'waterfall') {
    // In waterfall, reset to the selected chapter
    reader.currentChapterIndex.value = index
    resetWaterfall()
    await loadWaterfallChapter(index)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
    await fillWaterfallIfNeeded()
  } else {
    // 被更新的切章请求取代时，不保存进度也不调整滚动
    if (!await reader.loadChapter(index)) return
    await reader.saveProgress(0)
    await nextTick()
    if (contentRef.value) contentRef.value.scrollTop = 0
  }
}

// 瀑布流模式下容器里同时有多个章节，书签保存相对当前章节顶部的偏移
function getWaterfallChapterTop(index: number): number {
  const el = contentRef.value?.querySelector<HTMLElement>(`[data-chapter-index="${index}"]`)
  return el ? el.offsetTop : 0
}

async function handleAddBookmark() {
  const scrollTop = contentRef.value?.scrollTop || 0
  const offset = readerStore.settings.pageMode === 'waterfall'
    ? getWaterfallChapterTop(reader.currentChapterIndex.value)
    : 0
  await reader.addBookmark(Math.max(0, scrollTop - offset))
}

async function jumpToBookmark(chapterIndex: number, scrollTop: number) {
  tocVisible.value = false
  if (readerStore.settings.pageMode === 'waterfall') {
    reader.currentChapterIndex.value = chapterIndex
    resetWaterfall()
    await loadWaterfallChapter(chapterIndex)
    await nextTick()
    await document.fonts.ready
    if (contentRef.value) {
      contentRef.value.scrollTop = getWaterfallChapterTop(chapterIndex) + scrollTop
    }
    await fillWaterfallIfNeeded()
    return
  }
  // 不同章节才重新加载；同章节只需滚动，跳过会导致 scrollTop 归零的 loading 切换
  if (chapterIndex !== reader.currentChapterIndex.value) {
    if (!await reader.loadChapter(chapterIndex)) return
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

const tocChapters = computed(() => tocReversed.value ? [...reader.chapters.value].reverse() : reader.chapters.value)
const tocStatus = computed(() =>
  [bookFinished.value ? '已完结' : '', `共${reader.chapters.value.length}${unitLabel.value}`].filter(Boolean).join(' · '))

// 点「目录 / 书签」：同一个 Tab 再点一次关闭，否则打开并切到该 Tab
function openToc(tab: 'toc' | 'bookmark') {
  if (tocVisible.value && tocTab.value === tab) {
    tocVisible.value = false
    return
  }
  tocTab.value = tab
  tocVisible.value = true
  scrollTocToCurrent()
}

function switchTocTab(tab: 'toc' | 'bookmark') {
  tocTab.value = tab
  scrollTocToCurrent()
}

// 打开时把当前章节滚到可视区域中间
function scrollTocToCurrent() {
  nextTick(() => {
    if (tocTab.value === 'toc') {
      tocBodyRef.value?.querySelector<HTMLElement>('.toc-link.current')?.scrollIntoView({ block: 'center', behavior: 'instant' })
    } else if (tocBodyRef.value) {
      tocBodyRef.value.scrollTop = 0
    }
  })
}

// 点面板外部关闭（工具栏上的目录 / 书签按钮自己切换，不算外部）
function handleTocOutside(e: PointerEvent) {
  if (!tocVisible.value) return
  const target = e.target as HTMLElement | null
  if (!target || tocPanelRef.value?.contains(target) || target.closest('[data-toc-toggle]')) return
  if (target.closest('.el-overlay, .el-popper, .el-message-box')) return
  tocVisible.value = false
  tocClosedAt = Date.now()
}

// 「夜间」按钮：浅色主题切到夜间，深色主题切回护眼绿
const nightMode = computed(() => isDarkReaderTheme(readerStore.settings.theme))
function toggleNight() {
  readerStore.applyTheme(nightToggleTheme(readerStore.settings.theme))
}

// ── Settings ─────────────────────────────────────────────────
function saveSettings() {
  readerStore.updateSettings(readerStore.settings)
}

async function setPageMode(mode: 'scroll' | 'waterfall') {
  resetChapterPositionTracking()
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
// 取屏幕坐标处文字所在行的顶部（Chrome / Safari 用 caretRangeFromPoint，Firefox 用 caretPositionFromPoint）
function lineTopAtPoint(x: number, y: number, container: Element): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  let node: Node | null = null
  let offset = 0
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y)
    if (pos) { node = pos.offsetNode; offset = pos.offset }
  } else if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y)
    if (r) { node = r.startContainer; offset = r.startOffset }
  }
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null
  const len = node.textContent?.length ?? 0
  if (len === 0) return null
  const range = document.createRange()
  const start = Math.min(offset, len - 1)
  range.setStart(node, start)
  range.setEnd(node, start + 1)
  const rect = range.getClientRects()[0]
  return rect && rect.height > 0 ? rect.top : null
}

// 下翻：把距屏幕底部约两行的那一行对齐到顶部；找不到文字（如 PDF 页面图）时按固定距离
function textAlignedPageDistance(el: HTMLElement, lineHeightPx: number): number {
  const fallback = pageScrollDistance(el.clientHeight, lineHeightPx)
  const box = el.getBoundingClientRect()
  const contents = [...el.querySelectorAll<HTMLElement>('.chapter-content')]
  const target = box.bottom - lineHeightPx * 1.5
  // 测量点可能落在段落间距里，浏览器会返回远处的文字：在目标附近多试几个点，
  // 只接受确实位于「底部倒数第二行」附近的行，否则按固定距离翻
  for (const dy of [0, -lineHeightPx / 2, lineHeightPx / 2, -lineHeightPx]) {
    const y = target + dy
    const content = contents.find(c => { const r = c.getBoundingClientRect(); return r.top <= y && r.bottom >= y })
    if (!content) continue
    const lineTop = lineTopAtPoint(content.getBoundingClientRect().left + lineHeightPx, y, content)
    if (lineTop != null && lineTop >= target - lineHeightPx * 1.5 && lineTop <= target + lineHeightPx * 0.5) {
      return alignedPageDistance(lineTop, box.top, el.clientHeight)
    }
  }
  return fallback
}

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if ((e.target as HTMLElement | null)?.isContentEditable) return
  // 原生 PDF（浏览器内置查看器）或侧边抽屉打开时不处理
  if (e.key === 'Escape' && tocVisible.value) {
    tocVisible.value = false
    return
  }
  if (isPdf.value || settingsPanelVisible.value || tocVisible.value) return
  const action = readerKeyAction(e)
  if (!action) return
  e.preventDefault()
  const current = reader.currentChapterIndex.value
  const last = reader.chapters.value.length - 1
  const waterfall = readerStore.settings.pageMode === 'waterfall'
  switch (action) {
    case 'prevChapter':
      if (current > 0) waterfall ? jumpToChapter(current - 1) : goToPrevChapter()
      break
    case 'nextChapter':
      if (current < last) waterfall ? jumpToChapter(current + 1) : goToNextChapter()
      break
    case 'pageDown':
    case 'pageUp': {
      const el = contentRef.value
      if (!el) break
      // 顶部导航会盖住正文：翻屏时收起，且平滑滚动期间不因上滑重新弹出，保证衔接的行可见
      toolbarVisible.value = false
      keyPagingUntil = Date.now() + 800
      // 按屏翻页并保留两行正文作为衔接（行高随当前字号 / 行距变化）
      const lineHeightPx = readerStore.settings.fontSize * readerStore.settings.lineHeight
      const distance = action === 'pageDown'
        ? textAlignedPageDistance(el, lineHeightPx)
        : pageScrollDistance(el.clientHeight, lineHeightPx)
      el.scrollBy({ top: action === 'pageDown' ? distance : -distance, behavior: 'smooth' })
      break
    }
    case 'bookmark':
      if (!e.repeat) handleAddBookmark()  // 按住不放不重复添加
      break
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  document.addEventListener('pointerdown', handleTocOutside, true)
  document.addEventListener('visibilitychange', handleVisibilityChange)
  loadBookInfo()
  await readerStore.loadPrefs()
  await reader.loadChapters()

  if (isPdf.value) {
    await loadPdfBlob()
    return
  }
  // 文件下载与进度读取并行，页面在文档就绪后自动渲染
  if (isPdfRender.value) loadPdfDocument()

  await reader.loadProgress()
  reader.loadBookmarks()

  if (readerStore.settings.pageMode === 'waterfall') {
    await initWaterfall()
  } else {
    // 打开时用户若已切到别的章节，不再恢复旧进度位置
    if (!await reader.loadChapter(reader.progress.value.chapterIndex)) return
    await restoreChapterPosition({
      paragraphIndex: reader.progress.value.paragraphIndex ?? 0,
      paragraphOffset: reader.progress.value.paragraphOffset ?? 0,
    })
  }
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  // 位置尚未恢复完成就离开时不保存，避免用 0 覆盖原有进度
  const wasRestoring = restoringPosition
  stopRestore?.()
  if (!isPdf.value && !reader.loading.value && !wasRestoring) {
    if (readerStore.settings.pageMode === 'scroll') saveChapterPosition()
    else reader.saveProgress(0)
  }
})

onUnmounted(() => {
  cancelAnimationFrame(scrollRaf)
  window.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('pointerdown', handleTocOutside, true)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (pdfBlobUrl.value) URL.revokeObjectURL(pdfBlobUrl.value)
  pdfDoc.value?.loadingTask.destroy()
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

/* ── 阅读区（docs/reader-style-spec.md）：外围底色 + 居中纸张 ── */
/* 全屏极淡斜纹，营造纸面质感 */
.reader-page::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  background: repeating-linear-gradient(45deg, rgba(150,150,150,.02) 5px, transparent 30px, transparent 80px);
}

.reader-content {
  flex: 1;
  overflow-y: auto;
  overflow-anchor: none;
  background: var(--reader-page-bg);
  transition: background-color 0.3s ease;
}
/* 滚动条跟随阅读配色（全站滚动条轨道用的是网站主题底色，会在右侧露出一条异色） */
.reader-content::-webkit-scrollbar-track { background: var(--reader-page-bg); }
.reader-content::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-text) 22%, transparent); }
.reader-content::-webkit-scrollbar-thumb:hover { background: var(--reader-text-secondary); }

/* 纸张：细微噪点纹理平铺 */
.paper,
.reader-nav,
.side-tool,
.toc-panel {
  background-color: var(--reader-paper-bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.paper {
  position: relative;
  margin: 0 auto;
  min-height: 100%;
  padding: 0 64px 64px;
  transition: width 0.2s ease;
}

/* 顶部导航：吸顶，下滑隐藏、上滑显示 */
.reader-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  height: 64px;
  margin: 0 -64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--reader-divider);
  font-family: var(--font-sans);
  transition: transform 350ms ease;
}
.reader-nav.hidden { transform: translateY(-100%); }
.nav-title {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--reader-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-progress {
  font-size: 13px;
  color: var(--reader-text-secondary);
  white-space: nowrap;
}
.nav-actions { display: none; gap: 2px; }
.nav-btn,
.side-tool,
.end-btn {
  border: none;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  transition: color 0.15s ease, background-color 0.15s ease;
}
.nav-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.nav-btn:hover { color: var(--reader-text); }

/* 右侧悬浮工具栏：固定在纸张右外侧、垂直居中；64×64 竖排按钮 */
.side-tools {
  position: fixed;
  top: 50%;
  left: calc(50% + var(--paper-w) / 2 + 12px);
  transform: translateY(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-tool {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  background-color: var(--reader-toc-bg);
  box-shadow: var(--reader-toc-shadow);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.side-tool span {
  margin-top: 2px;
  font-size: 14px;
  line-height: 20px;
  color: var(--reader-text-secondary);
  transition: color 0.15s ease;
}
.side-tool:hover,
.side-tool:hover span,
.side-tool.on,
.side-tool.on span { color: var(--reader-accent); }

/* 章节标题区 */
.chapter-head { text-align: center; }
.chapter-heading {
  margin: 20px 0 0;
  font-family: var(--reader-font);
  font-size: 36px;
  line-height: 44px;
  font-weight: 500;
  color: var(--reader-text);
}
.chapter-meta {
  margin-top: 8px;
  font-family: var(--font-sans);
  font-size: 14px;
  color: var(--reader-text-secondary);
}

/* 正文：段距用 em，随字号同比缩放 */
.chapter-content {
  margin-top: 1.5em;
  font-weight: 400;
  color: var(--reader-text);
  transition: font-size 0.2s ease, line-height 0.2s ease;
}
.chapter-content :deep(p) {
  margin: 0.8em 0 0;
  text-indent: 2em;
}

/* 章末导航 */
.chapter-end {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 56px;
}
.end-btn {
  min-width: 96px;
  height: 40px;
  padding: 0 20px;
  border: 1px solid var(--reader-divider);
  border-radius: 20px;
  font-size: 14px;
}
.end-btn:hover:not(:disabled) {
  color: var(--reader-text);
  border-color: var(--reader-text-secondary);
}
.end-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* PDF 逐页渲染：失败提示居中显示 */
.pdf-chapter { margin-top: 24px; }
.pdf-chapter .pdf-error { padding: 80px 0; }

/* ── 瀑布流：章节之间用分隔线，第一章不加 ── */
.waterfall-chapter + .waterfall-chapter {
  margin-top: 56px;
  padding-top: 8px;
  border-top: 1px solid var(--reader-divider);
}
.waterfall-loading,
.waterfall-end {
  text-align: center;
  padding: 32px 0;
  font-size: 13px;
  color: var(--reader-text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

/* ── 目录面板（docs/reader-toc-spec.md）── */
.toc-layer {
  position: fixed;
  /* 右侧让出阅读区滚动条（6px），面板与纸张按同一宽度居中、正好重合 */
  inset: 0 6px 0 0;
  z-index: 20;
  pointer-events: none;
}
.toc-panel {
  pointer-events: auto;
  width: var(--paper-w);
  height: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  background-color: var(--reader-toc-bg);
  box-shadow: var(--reader-toc-shadow);
  color: var(--reader-text);
  font-family: var(--font-sans);
}
.toc-enter-active,
.toc-leave-active { transition: opacity 180ms ease, transform 180ms ease; }
.toc-enter-from,
.toc-leave-to { opacity: 0; transform: translateY(8px); }

.toc-head {
  margin-top: 36px;
  padding: 0 32px 0 22px;
  display: flex;
  align-items: flex-end;
  gap: 18px;
}
.toc-tab {
  padding: 6px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 24px;
  line-height: 32px;
  font-weight: 400;
  color: var(--reader-text-2);
  cursor: pointer;
}
.toc-tab.active { font-weight: 500; color: var(--reader-text); }
.toc-tab:hover { background: var(--reader-hover-bg); }
.toc-tab:active { background: var(--reader-active-bg); }
/* 状态文字紧跟「目录」Tab */
.toc-status {
  margin-left: calc(8px - 18px);
  padding-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--reader-text-secondary);
  white-space: nowrap;
}
.toc-actions { margin-left: auto; padding-bottom: 6px; display: flex; align-items: center; }
.toc-action.toc-close { display: none; }
.toc-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: inherit;
  font-size: 14px;
  color: var(--reader-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}
.toc-action:hover { color: var(--reader-accent); background: var(--reader-hover-bg); }

/* 列表滚动区：细滚动条 */
.toc-body {
  margin-top: 24px;
  padding: 0 16px 32px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.toc-body::-webkit-scrollbar { width: 6px; }
.toc-body::-webkit-scrollbar-track { background: transparent; }
.toc-body::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--reader-text) 18%, transparent); border-radius: 3px; }

/* 两列章节列表，每项底部分隔线两端内缩 16px */
.toc-list {
  list-style: none;
  margin: 8px 0 20px;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.toc-list li { position: relative; min-width: 0; }
.toc-list li::after {
  content: '';
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 0;
  height: 1px;
  background: var(--reader-divider);
}
.toc-link {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 16px;
  line-height: 24px;
  color: var(--reader-text);
  cursor: pointer;
}
.toc-link:hover { background: var(--reader-hover-bg); }
.toc-link:active { background: var(--reader-active-bg); }
.toc-link.current { color: var(--reader-accent); }
/* 已读：当前阅读章节之前的章节标题变浅灰 */
.toc-link.read { color: var(--reader-text-secondary); }
.toc-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.toc-note { margin-left: 8px; font-size: 13px; color: var(--reader-text-secondary); }
.toc-extra { flex-shrink: 0; font-size: 13px; color: var(--reader-text-secondary); }
.toc-del {
  flex-shrink: 0;
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--reader-text-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.toc-link:hover .toc-del,
.toc-del:focus-visible { opacity: 1; }
.toc-del:hover { color: var(--reader-accent); background: var(--reader-active-bg); }
.toc-empty {
  padding: 64px 0;
  text-align: center;
  font-size: 14px;
  color: var(--reader-text-secondary);
}

/* 窄屏：纸张与目录面板占满宽度，右侧工具栏收进顶部导航 */
@media (max-width: 768px) {
  .paper,
  .toc-panel { width: 100% !important; }
  .side-tools { display: none; }
  .nav-actions { display: flex; }
  .toc-action.toc-close { display: inline-flex; }
}
/* 手机（<640px） */
@media (max-width: 639px) {
  .paper { padding: 0 20px 48px; }
  .reader-nav {
    height: 56px;
    margin: 0 -20px;
    padding: 0 8px;
    gap: 4px;
  }
  .chapter-heading { font-size: 28px; line-height: 36px; }
  /* PDF 页面按原版缩放，尽量占满屏幕宽度 */
  .paper.pdf-wrapper { padding: 0 6px 16px; }
  .paper.pdf-wrapper .reader-nav { margin: 0 -6px; }
  /* 目录：单列，头部收紧，删除按钮常显（触屏无悬停） */
  .toc-head { margin-top: 20px; padding: 0 12px 0 6px; gap: 6px; }
  .toc-tab { font-size: 20px; line-height: 28px; }
  .toc-status { margin-left: 0; }
  .toc-body { margin-top: 12px; padding: 0 4px 24px; }
  .toc-list { grid-template-columns: 1fr; }
  .toc-extra { display: none; }
  .toc-del { opacity: 1; }
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

/* ── Progress ── */
.progress-info { font-size: 13px; color: var(--text-2); }

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

.shortcut-hint {
  margin-top: 16px;
  font-size: 12px;
  color: var(--text-2);
}
</style>
