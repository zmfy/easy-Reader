import http from './http'
import type { ApiResponse, Chapter, ReadingProgress, ReadingAnchor, Bookmark, Highlight, MindNode, ChainItem, ExpandedCandidate, AiRecap, AiAnswer } from '@/types'

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

  // AI 前情提要 / 问书：模型响应可能较慢，单独放宽超时
  recap: (bookId: string, chapterIndex: number, paragraphIndex: number) =>
    http.post<ApiResponse<AiRecap>>(`/reader/${bookId}/recap`, { chapterIndex, paragraphIndex }, { timeout: 180000 }),

  ask: (bookId: string, body: { question: string; chapterIndex: number; paragraphIndex: number; history: Array<{ q: string; a: string }> }) =>
    http.post<ApiResponse<AiAnswer>>(`/reader/${bookId}/ask`, body, { timeout: 180000 }),

  // 听书：合成一段文字的语音（mp3），后端按文本缓存
  tts: (bookId: string, text: string) =>
    http.post<Blob>(`/reader/${bookId}/tts`, { text }, { responseType: 'blob', timeout: 60000 }),

  deleteBookmark: (bookId: string, id: string) =>
    http.delete<ApiResponse<null>>(`/reader/${bookId}/bookmarks/${id}`),

  // 划线与批注
  getHighlights: (bookId: string) =>
    http.get<ApiResponse<Highlight[]>>(`/reader/${bookId}/highlights`),

  createHighlight: (bookId: string, body: { chapterIndex: number; startOffset: number; endOffset: number; text: string; note?: string }) =>
    http.post<ApiResponse<Highlight>>(`/reader/${bookId}/highlights`, body),

  updateHighlightNote: (bookId: string, id: string, note: string | null) =>
    http.patch<ApiResponse<Highlight>>(`/reader/${bookId}/highlights/${id}`, { note }),

  deleteHighlight: (bookId: string, id: string) =>
    http.delete<ApiResponse<null>>(`/reader/${bookId}/highlights/${id}`),

  expandHighlight: (bookId: string, highlightId: string, body: { center?: string; path?: string[]; force?: boolean }) =>
    http.post<ApiResponse<{ candidates: ExpandedCandidate[]; cached: boolean }>>(`/reader/${bookId}/highlights/${highlightId}/expand`, body, { timeout: 180000 }),

  getMindNodes: (bookId: string, highlightId?: string) =>
    http.get<ApiResponse<MindNode[]>>(`/reader/${bookId}/mind-nodes`, { params: highlightId ? { highlightId } : undefined }),

  keepMindChain: (bookId: string, highlightId: string, chain: ChainItem[]) =>
    http.post<ApiResponse<MindNode[]>>(`/reader/${bookId}/mind-nodes/keep`, { highlightId, chain }),

  addMindNode: (bookId: string, body: { parentId?: string; chapterIndex?: number; label: string; note?: string }) =>
    http.post<ApiResponse<MindNode>>(`/reader/${bookId}/mind-nodes`, body),

  updateMindNode: (bookId: string, id: string, patch: { label?: string; note?: string | null }) =>
    http.patch<ApiResponse<MindNode>>(`/reader/${bookId}/mind-nodes/${id}`, patch),

  deleteMindNode: (bookId: string, id: string) =>
    http.delete<ApiResponse<{ deleted: number }>>(`/reader/${bookId}/mind-nodes/${id}`),
}
