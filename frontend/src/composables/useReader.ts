import { ref, computed } from 'vue'
import { readerApi } from '@/api/reader'
import type { Chapter, Bookmark, Highlight, ReadingProgress, ReadingAnchor } from '@/types'
import type { TextAnchor } from '@/utils/highlight-anchor'
import { ElMessage } from 'element-plus'
import { canSaveProgress, type ProgressMode } from '@/utils/reader-view-mode'

export function useReader(bookId: string) {
  const chapters = ref<Chapter[]>([])
  const currentChapterIndex = ref(0)
  const currentContent = ref('')
  const bookmarks = ref<Bookmark[]>([])
  const highlights = ref<Highlight[]>([])
  const progress = ref<ReadingProgress>({ chapterIndex: 0, scrollTop: 0 })
  const loading = ref(false)
  const bookFormat = ref('')
  const pdfUsePlugin = ref(false)
  /** 查看模式（从学习导图打开）下所有进度保存都被跳过 */
  const progressMode = ref<ProgressMode>('normal')
  const savingAllowed = () => canSaveProgress(progressMode.value)

  const currentChapter = computed(() => chapters.value[currentChapterIndex.value])

  async function loadChapters() {
    const resp = await readerApi.getChapters(bookId)
    const data = resp.data.data
    chapters.value = data?.chapters || []
    bookFormat.value = data?.format || ''
    pdfUsePlugin.value = !!data?.pdfUsePlugin
  }

  // 章节请求序号：慢网下连续切章时，只采用最后一次请求的结果，避免旧响应覆盖新章节
  let chapterRequestSeq = 0

  /** 返回 true 表示结果已生效；false 表示期间又发起了新的切章请求，本次结果被丢弃 */
  async function loadChapter(index: number): Promise<boolean> {
    const seq = ++chapterRequestSeq
    loading.value = true
    try {
      const resp = await readerApi.getChapterContent(bookId, index)
      if (seq !== chapterRequestSeq) return false
      currentContent.value = resp.data.data?.content || ''
      currentChapterIndex.value = index
      return true
    } finally {
      if (seq === chapterRequestSeq) loading.value = false
    }
  }

  async function loadProgress() {
    const resp = await readerApi.getProgress(bookId)
    progress.value = resp.data.data || { chapterIndex: 0, scrollTop: 0 }
    currentChapterIndex.value = progress.value.chapterIndex
  }

  async function saveProgress(scrollTop: number, anchor: ReadingAnchor = { paragraphIndex: 0, paragraphOffset: 0 }) {
    if (!savingAllowed()) return
    const title = currentChapter.value?.title || ''
    await readerApi.saveProgress(bookId, currentChapterIndex.value, title, scrollTop, anchor)
  }

  function saveProgressOnHide(scrollTop: number, anchor: ReadingAnchor) {
    if (!savingAllowed()) return
    const title = currentChapter.value?.title || ''
    readerApi.saveProgressOnHide(bookId, currentChapterIndex.value, title, scrollTop, anchor)
  }

  async function loadBookmarks() {
    const resp = await readerApi.getBookmarks(bookId)
    bookmarks.value = resp.data.data || []
  }

  async function addBookmark(scrollTop: number, note?: string) {
    await readerApi.addBookmark(bookId, currentChapterIndex.value, Math.floor(scrollTop), note)
    await loadBookmarks()
    ElMessage.success('书签已添加')
  }

  async function deleteBookmark(id: string) {
    await readerApi.deleteBookmark(bookId, id)
    bookmarks.value = bookmarks.value.filter(b => b.id !== id)
    ElMessage.success('书签已删除')
  }

  // ── 划线 / 批注 ──
  async function loadHighlights() {
    const resp = await readerApi.getHighlights(bookId)
    highlights.value = resp.data.data || []
  }

  async function addHighlight(chapterIndex: number, anchor: TextAnchor, text: string, note?: string): Promise<Highlight> {
    const resp = await readerApi.createHighlight(bookId, { chapterIndex, startOffset: anchor.start, endOffset: anchor.end, text, note })
    const created = resp.data.data!
    highlights.value = [...highlights.value, created]
    return created
  }

  async function setHighlightNote(id: string, note: string | null) {
    const resp = await readerApi.updateHighlightNote(bookId, id, note)
    const updated = resp.data.data!
    highlights.value = highlights.value.map(h => h.id === id ? updated : h)
  }

  async function removeHighlight(id: string) {
    await readerApi.deleteHighlight(bookId, id)
    highlights.value = highlights.value.filter(h => h.id !== id)
  }

  async function fetchChapterContent(index: number): Promise<string> {
    const resp = await readerApi.getChapterContent(bookId, index)
    return resp.data.data?.content || ''
  }

  async function prevChapter() {
    if (currentChapterIndex.value > 0) {
      if (!await loadChapter(currentChapterIndex.value - 1)) return
      if (savingAllowed()) await readerApi.saveProgress(bookId, currentChapterIndex.value, currentChapter.value?.title || '', 0)
    }
  }

  async function nextChapter() {
    if (currentChapterIndex.value < chapters.value.length - 1) {
      if (!await loadChapter(currentChapterIndex.value + 1)) return
      if (savingAllowed()) await readerApi.saveProgress(bookId, currentChapterIndex.value, currentChapter.value?.title || '', 0)
    }
  }

  return {
    chapters, currentChapterIndex, currentContent, bookmarks, progress,
    loading, currentChapter, bookFormat, pdfUsePlugin, progressMode,
    loadChapters, loadChapter, fetchChapterContent, loadProgress, saveProgress, saveProgressOnHide,
    loadBookmarks, addBookmark, deleteBookmark, prevChapter, nextChapter,
    highlights, loadHighlights, addHighlight, setHighlightNote, removeHighlight,
  }
}
