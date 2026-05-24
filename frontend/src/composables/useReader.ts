import { ref, computed } from 'vue'
import { readerApi } from '@/api/reader'
import type { Chapter, Bookmark, ReadingProgress } from '@/types'
import { ElMessage } from 'element-plus'

export function useReader(bookId: string) {
  const chapters = ref<Chapter[]>([])
  const currentChapterIndex = ref(0)
  const currentContent = ref('')
  const bookmarks = ref<Bookmark[]>([])
  const progress = ref<ReadingProgress>({ chapterIndex: 0, scrollTop: 0 })
  const loading = ref(false)
  const bookFormat = ref('')
  const pdfUsePlugin = ref(false)

  const currentChapter = computed(() => chapters.value[currentChapterIndex.value])

  async function loadChapters() {
    const resp = await readerApi.getChapters(bookId)
    const data = resp.data.data
    chapters.value = data?.chapters || []
    bookFormat.value = data?.format || ''
    pdfUsePlugin.value = !!data?.pdfUsePlugin
  }

  async function loadChapter(index: number) {
    loading.value = true
    try {
      const resp = await readerApi.getChapterContent(bookId, index)
      currentContent.value = resp.data.data?.content || ''
      currentChapterIndex.value = index
    } finally {
      loading.value = false
    }
  }

  async function loadProgress() {
    const resp = await readerApi.getProgress(bookId)
    progress.value = resp.data.data || { chapterIndex: 0, scrollTop: 0 }
    currentChapterIndex.value = progress.value.chapterIndex
  }

  async function saveProgress(scrollTop: number) {
    const title = currentChapter.value?.title || ''
    await readerApi.saveProgress(bookId, currentChapterIndex.value, title, scrollTop)
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

  async function fetchChapterContent(index: number): Promise<string> {
    const resp = await readerApi.getChapterContent(bookId, index)
    return resp.data.data?.content || ''
  }

  async function prevChapter() {
    if (currentChapterIndex.value > 0) {
      await loadChapter(currentChapterIndex.value - 1)
      await readerApi.saveProgress(bookId, currentChapterIndex.value, currentChapter.value?.title || '', 0)
    }
  }

  async function nextChapter() {
    if (currentChapterIndex.value < chapters.value.length - 1) {
      await loadChapter(currentChapterIndex.value + 1)
      await readerApi.saveProgress(bookId, currentChapterIndex.value, currentChapter.value?.title || '', 0)
    }
  }

  return {
    chapters, currentChapterIndex, currentContent, bookmarks, progress,
    loading, currentChapter, bookFormat, pdfUsePlugin,
    loadChapters, loadChapter, fetchChapterContent, loadProgress, saveProgress,
    loadBookmarks, addBookmark, deleteBookmark, prevChapter, nextChapter,
  }
}
