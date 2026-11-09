import http from './http'
import type { ApiResponse, PaginatedResponse, Book } from '@/types'

export interface LibraryQuery {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  status?: 'normal' | 'problems' | 'duplicate' | 'duplicate_groups' | 'garbled' | 'all'
  ai_fill?: 'filled' | 'failed' | 'none' | 'all'
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

/** 与后端 services/file-deleter.ts 的 DeleteResult 一致 */
export interface BookDeleteResult {
  files_deleted: number
  records_deleted: number
  shelf_entries_affected: number
  warnings: string[]
}

export const libraryApi = {
  list: (params: LibraryQuery = {}) =>
    http.get<PaginatedResponse<Book>>('/library', { params }),

  scan: (payload: import('@/types').ScanStartOptions) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),

  aiFillBatch: (force = false) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/ai-fill-batch', { force }),

  aiFillResetFailed: () =>
    http.post<ApiResponse<{ reset: number }>>('/library/ai-fill-reset-failed'),

  aiFillResetAll: () =>
    http.post<ApiResponse<{ reset: number }>>('/library/ai-fill-reset-all'),

  get: (id: string) =>
    http.get<ApiResponse<Book>>(`/library/${id}`),

  update: (id: string, payload: UpdateBookPayload) =>
    http.put<ApiResponse<Book>>(`/library/${id}`, payload),


  // AI 填充预览：AI 与豆瓣检索可能需要一分多钟，超时单独放宽到 3 分钟
  aiFillPreview: (id: string, signal?: AbortSignal) =>
    http.post<ApiResponse<import('@/types').AiFillPreview>>(`/library/${id}/ai-fill/preview`, {}, { timeout: 180000, signal }),

  aiFillApply: (id: string, payload: import('@/types').AiFillApplyInput) =>
    http.post<ApiResponse<Book>>(`/library/${id}/ai-fill/apply`, payload),

  // 系统默认封面 SVG 文本（预览用）
  defaultCoverSvg: (params: { title: string; author?: string; category?: string }) =>
    http.get<string>('/library/default-cover', { params, responseType: 'text' }),

  // 多级分类：分类树 + 书数；旧分类整理（建议含 AI 批量调用，超时放宽到 3 分钟）
  categories: () =>
    http.get<ApiResponse<import('@/types').CategoryInfo>>('/library/categories'),
  legacyCategories: () =>
    http.get<ApiResponse<import('@/types').LegacyCategoryBook[]>>('/library/categories/legacy'),
  suggestLegacyCategories: () =>
    http.post<ApiResponse<import('@/types').CategorySuggestion[]>>('/library/categories/legacy/suggest', {}, { timeout: 180000 }),
  applyCategories: (items: Array<{ book_id: string; category: string }>) =>
    http.post<ApiResponse<{ updated: number }>>('/library/categories/legacy/apply', { items }),

  // 后台 AI 丰富的待确认建议
  aiSuggestions: () =>
    http.get<ApiResponse<import('@/types').AiSuggestion[]>>('/library/ai-suggestions'),
  aiSuggestionCount: () =>
    http.get<ApiResponse<{ count: number }>>('/library/ai-suggestions/count'),
  applyAiSuggestions: (items: import('@/types').AiSuggestionSelection[]) =>
    http.post<ApiResponse<{ applied: string[]; failed: Array<{ book_id: string; error: string }> }>>(
      '/library/ai-suggestions/apply', { items }, { timeout: 120000 }),
  dismissAiSuggestions: (bookIds: string[]) =>
    http.post<ApiResponse<{ dismissed: number }>>('/library/ai-suggestions/dismiss', { book_ids: bookIds }),
  dismissContentMismatch: (id: string) =>
    http.post<ApiResponse<null>>(`/library/${id}/content-mismatch/dismiss`, {}),

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
    ai_fill?: 'all' | 'filled' | 'failed' | 'none';
    /** '1'：只看 AI 判定文件名与正文不符的书 */
    mismatch?: '1';
    status?: 'normal' | 'problems' | 'duplicate' | 'duplicate_groups' | 'garbled' | 'all';
  } = {}) =>
    http.get<PaginatedResponse<Book>>('/library', { params }),

  estimate: (params: { ai_fill?: boolean; full_rescan?: boolean; force?: boolean }) =>
    http.get<ApiResponse<import('@/types').CostEstimate>>('/library/scan/estimate', { params }),

  // keep_file=true 仅删除书库记录、保留磁盘文件；默认连同磁盘文件一起删除
  removeWithOptions: (id: string, opts: { cascade_duplicates?: boolean; confirm_shelf_impact?: boolean; keep_file?: boolean } = {}) =>
    http.delete<ApiResponse<BookDeleteResult>>(
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
