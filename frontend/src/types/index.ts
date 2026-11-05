export interface User {
  id: string
  username: string
  role: 'admin' | 'user'
  created_at?: string
  /** 仍在使用默认密码：必须先改密码才能使用其他功能 */
  mustChangePassword?: boolean
}

export interface Book {
  id: string
  title: string
  /** 清洗掉版本标记、作者等后的书名，仅用于显示 */
  display_title?: string
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
  ai_fill_status?: 'filled' | 'failed' | null
  rating?: number | null
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
  /** 清洗后的书名，仅用于显示 */
  display_title?: string
  author?: string
  cover_url?: string
  category?: string
  file_format?: string
  chapter_index?: number
  chapter_title?: string
  scroll_top?: number
}

export interface ReadingProgress {
  /** 是否读过（无进度记录时为 false） */
  hasProgress?: boolean
  chapterIndex: number
  chapterTitle?: string
  scrollTop: number
  paragraphIndex?: number
  paragraphOffset?: number
  updated_at?: string
  /** 上次阅读时间（SQLite UTC 字符串），用于判断是否提示「前情提要」 */
  updatedAt?: string | null
}

export interface AiRecap { content: string; cached: boolean; chapters: string[] }
export interface AiAnswer { answer: string; sources: Array<{ chapterIndex: number; title: string }> }

/** 章内阅读位置：屏幕顶部所在段落的序号 + 该段落已读过的比例（0–1） */
export interface ReadingAnchor {
  paragraphIndex: number
  paragraphOffset: number
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

export interface Highlight {
  id: string
  user_id: string
  book_id: string
  chapter_index: number
  start_offset: number
  end_offset: number
  text: string
  note: string | null
  created_at: string
  updated_at: string
}

export type MindKind = 'highlight' | 'event' | 'concept' | 'person' | 'custom'

export interface MindNode {
  id: string
  user_id: string
  book_id: string
  parent_id: string | null
  chapter_index: number
  highlight_id: string | null
  label: string
  kind: MindKind
  summary: string | null
  note: string | null
  source_chapter: number | null
  source_paragraph: number | null
  sort: number
  created_at: string
}

export interface ChainItem {
  label: string
  kind: 'event' | 'concept' | 'person'
  summary?: string
  source?: { chapterIndex: number; paragraphIndex: number } | null
}

export interface ExpandedCandidate {
  label: string
  kind: 'event' | 'concept' | 'person'
  summary: string
  source: { chapterIndex: number; paragraphIndex: number; chapterTitle: string; later: boolean } | null
}

export interface Chapter {
  index: number
  title: string
  href?: string
  /** 目录层级（0 为顶层），单层目录时省略 */
  level?: number
  /** 从这一章开始的分组标题（TXT「第一部 小丑」），分组本身不是章节 */
  groupTitle?: string
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

export type ReaderTheme = 'indigo' | 'white' | 'eye-care' | 'night' | 'dark' | 'light-green' | 'light-blue' | 'light-gray' | 'light-yellow' | 'light-brown'

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
  /** 漫画等纯图片页：适合高度（一屏一页）/ 适合宽度（铺满纸张宽度，上下滚动） */
  imageFit: 'height' | 'width'
}

export type ScanStage = 'walking' | 'fingerprinting' | 'dedup' | 'staging' | 'ai_fill'

export interface ScanTask {
  id: string
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  stage: ScanStage | null
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
  mode: 'auto' | 'review'
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

export interface Series {
  id: string
  name: string
  summary?: string
  cover_url?: string
  author?: string
  created_at: string
  member_count?: number
}

export interface SeriesDetail {
  series: Series
  members: Book[]
}

export type AuditAction =
  | 'delete_book_file'
  | 'delete_book_record'
  | 'apply_batch'
  | 'discard_batch'
  | 'create_manual_override'
  | 'delete_manual_override'
  | 'ai_fill_book'
  | 'ai_fetch_cover'

export interface AuditLog {
  id: string
  user_id: string
  action: AuditAction
  resource_id?: string | null
  file_path?: string | null
  details?: string | null
  created_at: string
}

export interface BookAiMetadata {
  book_id: string
  recommended_tags: string[]
  similar_works: Array<{ title: string; author?: string; reason?: string }>
  generated_by?: string | null
  generated_at: string
}

// ── 单本 AI 填充预览（与 backend/src/services/ai-fill-preview.ts / ai-fill-apply.ts 对应）──
export type SimilarWork = { title: string; author?: string; reason?: string }
export type AiFillLockableField = 'author' | 'summary' | 'category'

export interface AiFillCoverCandidate {
  title: string
  author?: string
  year?: string
  pic: string
  subjectUrl?: string
  thumbnail: string
}

export interface AiFillPreview {
  current: {
    title: string; author: string | null; summary: string | null; category: string | null
    is_finished: boolean | null; cover_url: string | null
    recommended_tags: string[]; similar_works: SimilarWork[]
  }
  suggested: {
    author?: string; summary?: string; category?: string; is_finished?: boolean
    recommended_tags: string[]; similar_works: SimilarWork[]
  }
  lockedFields: AiFillLockableField[]
  coverTitle: string
  coverCandidates: AiFillCoverCandidate[]
}

export type AiFillCoverChoice = { type: 'keep' } | { type: 'douban'; pic: string } | { type: 'default' }

export interface AiFillApplyInput {
  author?: string
  summary?: string
  category?: string
  is_finished?: boolean
  recommended_tags: string[]
  similar_works: SimilarWork[]
  cover: AiFillCoverChoice
  ratingSubjectUrl?: string
  coverTitle?: string
  suggested: { author?: string; summary?: string; category?: string }
}

export interface CostEstimate {
  fill: number
  total: number
  active_plugin: string | null
  tier: 'free' | 'low' | 'high' | 'unknown'
}

export type ManualOverrideType = 'not_duplicate' | 'not_in_series' | 'forced_duplicate' | 'forced_series_member'

export interface ManualOverride {
  id: string
  type: ManualOverrideType
  book_id_a: string | null
  book_id_b: string | null
  series_id: string | null
  created_by: string
  created_at: string
}
