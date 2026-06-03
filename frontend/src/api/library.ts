import http from './http'
import type { ApiResponse, PaginatedResponse, Book } from '@/types'

export interface LibraryQuery {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  status?: 'normal' | 'problems' | 'duplicate' | 'garbled' | 'all'
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

  scan: (payload: import('@/types').ScanStartOptions) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),

  aiFillBatch: (force = false) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/ai-fill-batch', { force }),

  get: (id: string) =>
    http.get<ApiResponse<Book>>(`/library/${id}`),

  update: (id: string, payload: UpdateBookPayload) =>
    http.put<ApiResponse<Book>>(`/library/${id}`, payload),

  remove: (id: string, withFile = false) =>
    http.delete<ApiResponse<{ fileDeleted: boolean; fileError: string | null } | null>>(
      `/library/${id}`,
      { params: withFile ? { with_file: true } : {} },
    ),

  aiFill: (id: string) =>
    http.post<ApiResponse<Book>>(`/library/${id}/ai-fill`),

  getAiMetadata: (id: string) =>
    http.get<ApiResponse<import('@/types').BookAiMetadata | null>>(`/library/${id}/ai-metadata`),

  normalizeChapters: (id: string) =>
    http.post<ApiResponse<{ total: number; normalized: number; failed_batches: number }>>(`/library/${id}/normalize-chapters`),

  clearNormalizedChapters: (id: string) =>
    http.delete<ApiResponse<{ cleared: number }>>(`/library/${id}/normalize-chapters`),

  getNormalizedChapterCount: (id: string) =>
    http.get<ApiResponse<{ count: number }>>(`/library/${id}/normalize-chapters`),

  lookupByTitles: (titles: Array<{ title: string; author?: string }>) =>
    http.post<ApiResponse<Array<{ title: string; author?: string; book_id: string | null }>>>(
      '/library/lookup-by-titles',
      { titles },
    ),

  coverTest: (id: string) =>
    http.post<ApiResponse<{ coverUrl: string | undefined; bookTitle: string }>>(`/library/${id}/cover-test`),

  listAdmin: (params: {
    page?: number; pageSize?: number; search?: string; category?: string;
    include_dirty?: boolean; series_grouped?: boolean;
    sortBy?: string; sortOrder?: 'asc' | 'desc';
  } = {}) =>
    http.get<PaginatedResponse<Book>>('/library', { params }),

  estimate: (params: { ai_dedup?: boolean; ai_series?: boolean; ai_fill?: boolean; full_rescan?: boolean }) =>
    http.get<ApiResponse<import('@/types').CostEstimate>>('/library/scan/estimate', { params }),

  removeWithOptions: (id: string, opts: { cascade_duplicates?: boolean; confirm_shelf_impact?: boolean } = {}) =>
    http.delete<ApiResponse<{ files_deleted: number; records_deleted: number; shelf_entries_affected: number; warnings: string[] }>>(
      `/library/${id}`,
      { params: opts },
    ),

  manualOverrides: {
    list: (type?: import('@/types').ManualOverrideType) =>
      http.get<ApiResponse<import('@/types').ManualOverride[]>>('/library/manual-overrides', { params: { type } }),
    create: (payload: { type: import('@/types').ManualOverrideType; book_id_a: string | null; book_id_b?: string | null; series_id?: string | null }) =>
      http.post<ApiResponse<import('@/types').ManualOverride>>('/library/manual-overrides', payload),
    remove: (id: string) =>
      http.delete<ApiResponse<null>>(`/library/manual-overrides/${id}`),
    removeAll: () =>
      http.delete<ApiResponse<{ deleted: number }>>('/library/manual-overrides/all'),
  },
}
