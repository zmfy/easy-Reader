import http from './http'
import type { ApiResponse, HistoryItem, PaginatedResponse } from '@/types'

/** 阅读历史：进入阅读器自动记录，按最近打开倒序 */
export const historyApi = {
  list: (page = 1, pageSize = 30) =>
    http.get<PaginatedResponse<HistoryItem>>('/history', { params: { page, pageSize } }),

  record: (bookId: string) =>
    http.post<ApiResponse<null>>(`/history/${bookId}`, {}),

  remove: (bookId: string) =>
    http.delete<ApiResponse<null>>(`/history/${bookId}`),

  clear: () =>
    http.delete<ApiResponse<{ removed: number }>>('/history'),
}
