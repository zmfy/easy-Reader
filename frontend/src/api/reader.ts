import http from './http'
import type { ApiResponse, Chapter, ReadingProgress, Bookmark } from '@/types'

export const readerApi = {
  getChapters: (bookId: string) =>
    http.get<ApiResponse<{ chapters: Chapter[]; format: string }>>(`/reader/${bookId}/chapters`),

  getRaw: (bookId: string) =>
    http.get(`/reader/${bookId}/raw`, { responseType: 'arraybuffer' }),

  getChapterContent: (bookId: string, index: number) =>
    http.get<ApiResponse<{ index: number; content: string }>>(`/reader/${bookId}/chapter/${index}`),

  getProgress: (bookId: string) =>
    http.get<ApiResponse<ReadingProgress>>(`/reader/${bookId}/progress`),

  saveProgress: (bookId: string, chapterIndex: number, chapterTitle: string, scrollTop: number) =>
    http.post<ApiResponse<ReadingProgress>>(`/reader/${bookId}/progress`, { chapterIndex, chapterTitle, scrollTop }),

  getBookmarks: (bookId: string) =>
    http.get<ApiResponse<Bookmark[]>>(`/reader/${bookId}/bookmarks`),

  addBookmark: (bookId: string, chapterIndex: number, scrollTop: number, note?: string) =>
    http.post<ApiResponse<Bookmark>>(`/reader/${bookId}/bookmarks`, { chapterIndex, scrollTop, note }),

  deleteBookmark: (bookId: string, id: string) =>
    http.delete<ApiResponse<null>>(`/reader/${bookId}/bookmarks/${id}`),
}
