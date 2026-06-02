export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  created_at?: string
}

export interface Book {
  id: string
  title: string
  author?: string
  file_path: string
  file_format: string
  cover_url?: string
  summary?: string
  category?: string
  tags?: string
  publish_date?: string
  finish_date?: string
  is_finished: number
  file_size?: number
  imported_at: string
  // 扫描增强字段（Plan 1/2）
  status?: 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed'
  duplicate_of?: string | null
  series_id?: string | null
  chapter_count?: number
  fingerprint?: string
  first_chapter_hash?: string
  encoding_detected?: string
  manually_edited_fields?: string
}

export interface ShelfItem {
  id: string
  user_id: string
  book_id: string
  added_at: string
  last_read_at?: string
  // Joined fields
  title?: string
  author?: string
  cover_url?: string
  category?: string
  file_format?: string
  chapter_index?: number
  chapter_title?: string
  scroll_top?: number
}

export interface ReadingProgress {
  chapterIndex: number
  chapterTitle?: string
  scrollTop: number
  updated_at?: string
}

export interface Bookmark {
  id: string
  user_id: string
  book_id: string
  chapter_index: number
  scroll_top: number
  note?: string
  created_at: string
}

export interface Chapter {
  index: number
  title: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  code: string
  message: string
  data?: T
}

export interface PaginatedResponse<T> {
  success: boolean
  code: string
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export type ReaderTheme = 'white' | 'eye-care' | 'night' | 'dark' | 'light-green' | 'light-blue' | 'light-gray' | 'light-yellow' | 'light-brown'

export interface ReaderSettings {
  fontFamily: string
  fontSize: number
  letterSpacing: number
  lineHeight: number
  pageWidth: number       // 20–98 (percentage of container width)
  theme: ReaderTheme
  backgroundColor: string
  fontColor: string
  pageMode: 'scroll' | 'waterfall'
}

export interface ScanTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  stage: 'walking' | 'fingerprinting' | 'staging' | null
  total_files: number
  processed_files: number
  options: string
  started_by: string
  started_at: string
  finished_at?: string | null
  error?: string | null
}

export type ScanBatchStatus = 'pending' | 'applied' | 'discarded'
export type ScanBatchItemType = 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed' | 'ai_fill_failed'

export interface ScanBatch {
  id: string
  task_id: string
  status: ScanBatchStatus
  summary_counts: string
  created_at: string
  applied_at?: string | null
  applied_by?: string | null
  apply_summary?: string | null
}

export interface ScanBatchItem {
  id: string
  batch_id: string
  type: ScanBatchItemType
  payload: string
  admin_decision?: 'accept' | 'reject' | 'modified' | null
  admin_payload?: string | null
  reviewed_at?: string | null
  reviewed_by?: string | null
}

export interface ScanStartOptions {
  mode: 'auto' | 'review' | 'hybrid'
  ai_dedup: boolean
  ai_series: boolean
  ai_fill: boolean
  full_rescan: boolean
}

export interface NewBookPayload {
  file_path: string
  title: string
  file_format: string
  file_size: number
  chapter_count?: number
  fingerprint?: string
  first_chapter_hash?: string
  encoding_detected?: string
  status?: 'normal' | 'encoding_fixed'
}

export interface DuplicateGroupPayload {
  canonical_file_path: string
  members: Array<{
    file_path: string
    fingerprint: string
    decision_type: 'hard' | 'ai'
    ai_confidence?: number
  }>
  rejected_members?: Array<{ file_path: string; fingerprint?: string }>
}

export interface SeriesGroupPayload {
  series_name: string
  author?: string
  members: Array<{ file_path: string; sequence: number }>
  source: 'regex' | 'ai'
  confidence?: 'high' | 'medium' | 'low'
  rejected_members?: string[]
}

export interface GarbledPayload {
  file_path: string
  reason: string
}

export interface EncodingFixedPayload {
  file_path: string
  from_encoding: string
  to_encoding: 'utf-8'
}
