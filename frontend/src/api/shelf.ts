import http from './http'
import type { ApiResponse, ShelfItem } from '@/types'

export const shelfApi = {
  list: () =>
    http.get<ApiResponse<ShelfItem[]>>('/shelf'),

  status: (bookId: string) =>
    http.get<ApiResponse<{ inShelf: boolean }>>(`/shelf/${bookId}`),

  add: (bookId: string) =>
    http.post<ApiResponse<ShelfItem>>('/shelf', { bookId }),

  remove: (bookId: string) =>
    http.delete<ApiResponse<null>>(`/shelf/${bookId}`),
}
