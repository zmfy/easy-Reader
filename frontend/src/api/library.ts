import http from './http'
import type { ApiResponse, PaginatedResponse, Book } from '@/types'

export interface LibraryQuery {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface UpdateBookPayload {
  title?: string
  author?: string
  cover_url?: string
  summary?: string
  category?: string
  tags?: string[]
  publish_date?: string
  finish_date?: string
  is_finished?: boolean
}

export const libraryApi = {
  list: (params: LibraryQuery = {}) =>
    http.get<PaginatedResponse<Book>>('/library', { params }),

  scan: () =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan'),

  get: (id: string) =>
    http.get<ApiResponse<Book>>(`/library/${id}`),

  update: (id: string, payload: UpdateBookPayload) =>
    http.put<ApiResponse<Book>>(`/library/${id}`, payload),

  remove: (id: string) =>
    http.delete<ApiResponse<null>>(`/library/${id}`),

  aiFill: (id: string) =>
    http.post<ApiResponse<Book>>(`/library/${id}/ai-fill`),

  coverTest: (id: string) =>
    http.post<ApiResponse<{ coverUrl: string | undefined; bookTitle: string }>>(`/library/${id}/cover-test`),
}
