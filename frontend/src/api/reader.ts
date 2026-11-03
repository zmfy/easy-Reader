import http from './http'
import type { ApiResponse, Chapter, ReadingProgress, ReadingAnchor, Bookmark } from '@/types'

export const readerApi = {
  getChapters: (bookId: string) =>
    http.get<ApiResponse<{ chapters: Chapter[]; format: string; pdfUsePlugin?: boolean }>>(`/reader/${bookId}/chapters`),

  getRaw: (bookId: string) =>
    http.get(`/reader/${bookId}/raw`, { responseType: 'arraybuffer' }),

  getChapterContent: (bookId: string, index: number) =>
    http.get<ApiResponse<{ index: number; content: string }>>(`/reader/${bookId}/chapter/${index}`),

  getProgress: (bookId: string) =>
    http.get<ApiResponse<ReadingProgress>>(`/reader/${bookId}/progress`),

  saveProgress: (bookId: string, chapterIndex: number, chapterTitle: string, scrollTop: number, anchor?: ReadingAnchor) =>
    http.post<ApiResponse<ReadingProgress>>(`/reader/${bookId}/progress`, { chapterIndex, chapterTitle, scrollTop, ...anchor }),

  // 页面切到后台/关闭时使用：keepalive 保证页面卸载后请求仍会发出（axios 请求可能被中断）
  saveProgressOnHide: (bookId: string, chapterIndex: number, chapterTitle: string, scrollTop: number, anchor: ReadingAnchor) => {
    const token = localStorage.getItem('accessToken')
    return fetch(`/api/reader/${bookId}/progress`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ chapterIndex, chapterTitle, scrollTop, ...anchor }),
    }).catch(() => undefined)
  },

  getBookmarks: (bookId: string) =>
    http.get<ApiResponse<Bookmark[]>>(`/reader/${bookId}/bookmarks`),

  addBookmark: (bookId: string, chapterIndex: number, scrollTop: number, note?: string) =>
    http.post<ApiResponse<Bookmark>>(`/reader/${bookId}/bookmarks`, { chapterIndex, scrollTop, note }),

  deleteBookmark: (bookId: string, id: string) =>
    http.delete<ApiResponse<null>>(`/reader/${bookId}/bookmarks/${id}`),
}
