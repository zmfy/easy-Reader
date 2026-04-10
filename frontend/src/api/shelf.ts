import http from './http'
import type { ApiResponse, ShelfItem } from '@/types'

export const shelfApi = {
  list: () =>
    http.get<ApiResponse<ShelfItem[]>>('/shelf'),

  add: (bookId: string) =>
    http.post<ApiResponse<ShelfItem>>('/shelf', { bookId }),

  remove: (bookId: string) =>
    http.delete<ApiResponse<null>>(`/shelf/${bookId}`),
}
