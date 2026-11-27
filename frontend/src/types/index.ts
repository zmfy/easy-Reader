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
  status?: 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed' | 'damaged'
  /** status 为 damaged 时：文件损坏的原因 */
  damage_reason?: string | null
  ai_fill_status?: 'filled' | 'failed' | null
  rating?: number | null
  duplicate_of?: string | null
  series_id?: string | null
  chapter_count?: number
  fingerprint?: string
  first_chapter_hash?: string
  encoding_detected?: string
  manually_edited_fields?: string
  /** AI 判定正文与文件名不是同一本书：JSON { title, author?, reason?, dismissed? }（见 parseContentMismatch） */
  content_mismatch?: string | null
  /** 整理版的原文件在整理之后变过（仅整理版详情返回） */
  organized_stale?: boolean
}

/** 阅读历史一项：最近打开的在前，附阅读进度 */
export interface HistoryItem {
  book_id: string
  opened_at: string
  title: string
  /** 清洗后的书名，仅用于显示 */
  display_title?: string
  author: string | null
  cover_url: string | null
  category: string | null
  file_format: string
  chapter_index: number | null
  chapter_title: string | null
  progress_updated_at: string | null
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

export type ReaderTheme = 'indigo' | 'white' | 'eye-care' | 'night' | 'dark' | 'light-green' | 'light-blue' | 'light-gray' | 'light-yellow' | 'light-brown' | 'eink'

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
  /** 点击屏幕：左右两侧翻页、中间呼出菜单（所有主题）；关闭时点哪里都只呼出菜单 */
  tapPaging: boolean
}

export type ScanStage = 'walking' | 'fingerprinting' | 'dedup' | 'staging' | 'ai_fill'

export interface ScanTask {
  id: string
  /** paused：AI 额度用完 / 连续失败自动暂停，error 为原因；再次启动填充即接着处理 */
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed' | 'paused'
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
export type ScanBatchItemType = 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed' | 'ai_fill_failed' | 'damaged' | 'organized_duplicate'

export interface ScanBatch {
  id: string
  task_id: string
  status: ScanBatchStatus
  summary_counts: string
  created_at: string
  applied_at?: string | null
  applied_by?: string | null
  apply_summary?: string | null
  /** 同一次扫描拆成多批（每批最多 500 本）时：第几批 / 共几批 */
  part_index?: number | null
  part_count?: number | null
  /** scan 扫描生成；organize 是 TXT 目录 AI 整理的审核（只有一条 organized_duplicate） */
  kind?: 'scan' | 'organize'
  /** 仅列表接口：整理审核批次的原书名 */
  organize_title?: string | null
}

/** TXT 目录 AI 整理任务（notes 只有管理员能看到） */
export interface OrganizeJob {
  id: string
  book_id: string
  requested_by: string
  status: 'pending' | 'running' | 'review' | 'failed' | 'done'
  phase: 'candidates' | 'judging' | 'writing' | null
  batches_done: number
  batches_total: number
  candidate_count: number
  notes?: string[]
  result_book_id: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface OrganizeStatus {
  available: boolean
  job: OrganizeJob | null
  lastRejectedAt: string | null
}

export type OrganizeDecision = 'keep_new_hide_old' | 'keep_new_delete_record' | 'keep_new_delete_file' | 'keep_old'

interface OrganizeSide {
  book_id: string
  title: string
  file_path: string
  chapter_count: number
  toc: Array<{ title: string; level: number }>
}

/** 审核项 organized_duplicate 的 payload */
export interface OrganizedDuplicatePayload {
  job_id: string
  original: OrganizeSide
  organized: OrganizeSide
  notes: string[]
  batches: number
  candidate_count: number
  requested_by: { user_id: string; username: string }
}

/** 应用整理审核批次的结果（存在 scan_batches.apply_summary） */
export interface OrganizeApplySummary {
  decision: OrganizeDecision
  migrated: { progress: number; bookmarks: number; shelf: number; history: number }
  warnings?: string[]
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
  /** EPUB 打开时被自动修正过 */
  repaired?: boolean
}

export interface DuplicateGroupPayload {
  canonical_file_path: string
  members: Array<{
    file_path: string
    fingerprint: string
    decision_type: 'hard' | 'ai' | 'soft'  // hard=指纹相同；soft=书名相同（作者一致或为空）；ai=AI 判定
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

/** 打不开或没有章节的 EPUB：逐本选择导入（accept）或跳过（reject） */
export interface DamagedPayload {
  file_path: string
  file_size: number
  file_mtime: number | null
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
  | 'ai_suggestion_apply'
  | 'opds_enable'
  | 'opds_reset'
  | 'opds_disable'

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
  adaptations?: BookAdaptation[]
  generated_by?: string | null
  generated_at: string
}

/** 改编作品（与 backend/src/services/adaptations.ts 对应） */
export type BookAdaptationType = '电影' | '电视剧' | '短剧' | '动画' | '广播剧' | '其他'
export interface BookAdaptation {
  type: BookAdaptationType
  title: string
  year?: string
  source: 'douban' | 'missevan'
  url: string
}

// ── 单本 AI 填充预览（与 backend/src/services/ai-fill-preview.ts / ai-fill-apply.ts 对应）──
export type SimilarWork = { title: string; author?: string; reason?: string }
export type AiFillLockableField = 'title' | 'author' | 'summary' | 'category'

/** AI 查证过程中的一步（与后端 LookupStep 一致） */
export type LookupStep =
  | { kind: 'search_book' | 'search_movie' | 'search_drama'; query: string; count: number; error?: boolean }
  | { kind: 'open_book'; id: string; label: string }
  | { kind: 'confirm_book'; id: string; label: string; why?: string }
  | { kind: 'no_book'; why?: string }
  | { kind: 'pick_adaptations'; count: number }
  | { kind: 'invalid' }

export interface AiFillCoverCandidate {
  title: string
  author?: string
  year?: string
  pic: string
  subjectUrl?: string
  /** 改编作品的海报 / 封面：电视剧、电影、广播剧等；豆瓣书封不带 */
  kind?: string
  thumbnail: string
}

export type AiFillConfidence = 'high' | 'medium' | 'low'

export interface AiFillPreview {
  current: {
    title: string; author: string | null; summary: string | null; category: string | null
    is_finished: boolean | null; cover_url: string | null
    recommended_tags: string[]; similar_works: SimilarWork[]
    adaptations: BookAdaptation[]
  }
  suggested: {
    title?: string; author?: string; summary?: string; category?: string; is_finished?: boolean
    recommended_tags: string[]; similar_works: SimilarWork[]
    /** 改编作品：外部平台候选经 AI 筛选，每条有来源链接 */
    adaptations: BookAdaptation[]
    /** 各字段置信度：low = 只凭书名和模型知识，默认不采用 */
    confidence?: Partial<Record<AiFillLockableField, AiFillConfidence>>
    /** 各字段依据 */
    evidence?: Partial<Record<AiFillLockableField, string>>
  }
  lockedFields: AiFillLockableField[]
  coverTitle: string
  coverCandidates: AiFillCoverCandidate[]
  /** 文件内置封面（data URI，目前只有 EPUB）；没有时省略 */
  embeddedCover?: string
  /** AI 判定正文与文件名不是同一部作品 */
  contentMismatch?: ContentMismatch
  /** 查证过程（按顺序）；未启用查证时为空 */
  lookupTrace: LookupStep[]
  /** 查证未能完成，改按书名直接搜索 */
  lookupUsedFallback: boolean
}

export type AiFillCoverChoice = { type: 'keep' } | { type: 'douban'; pic: string } | { type: 'embedded' } | { type: 'default' }

export interface AiFillApplyInput {
  title?: string
  author?: string
  summary?: string
  category?: string
  is_finished?: boolean
  recommended_tags: string[]
  similar_works: SimilarWork[]
  adaptations: BookAdaptation[]
  cover: AiFillCoverChoice
  ratingSubjectUrl?: string
  coverTitle?: string
  suggested: { title?: string; author?: string; summary?: string; category?: string }
}

export interface AiFillProgress {
  steps: LookupStep[]
  done: boolean
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
  /** 书名 / 系列名；书或系列已删除时为 null */
  title_a?: string | null
  title_b?: string | null
  series_name?: string | null
}

export interface ReleaseItem {
  text: string
  actionRequired: boolean
}

export interface ReleaseSection {
  title: string
  kind: 'added' | 'fixed' | 'other'
  items: ReleaseItem[]
}

export interface Release {
  version: string
  date: string | null
  intro: string
  sections: ReleaseSection[]
}

export interface UpdateStatus {
  currentVersion: string | null
  branch: string
  enabled: boolean
  noticeEnabled: boolean
  envDisabled: boolean
  checkedAt: string | null
  error: string | null
  newer: Release[]
  usageStatsEnabled: boolean
  usageStatsEnvDisabled: boolean
}

// ── HTTPS（使用自己的证书）────────────────────────────────
export interface HttpsCertInfo {
  domains: string[]
  issuer: string
  notBefore: string
  notAfter: string
  expired: boolean
  notYetValid: boolean
  daysLeft: number
}

export interface HttpsStatus {
  /** 设置页「启用 HTTPS」开关；关闭时不提供 HTTPS */
  enabled: boolean
  listening: boolean
  port: number
  cert: HttpsCertInfo | null
  lastError: string | null
  /** 到期提醒文案（剩余 14 天内 / 已过期），否则 null */
  warning: string | null
  /** 仅上传接口返回：如「证书已过期」 */
  warnings?: string[]
}

// ── 多级分类（与 backend/src/utils/category-tree.ts、services/category-migrate.ts 对应）──
export interface CategoryNode {
  name: string
  children?: CategoryNode[]
}

export interface CategoryInfo {
  tree: CategoryNode[]
  /** 各分类路径（含下级）的书数 */
  counts: Record<string, number>
  /** 内置默认分类树（设置页「恢复默认」用） */
  defaultTree: CategoryNode[]
}

export interface LegacyCategoryBook {
  id: string
  title: string
  author: string | null
  category: string
}

export interface CategorySuggestion extends LegacyCategoryBook {
  suggested?: string
  source?: 'map' | 'ai'
}

// ── 后台 AI 丰富的待确认建议（与 backend/src/services/ai-suggestions.ts 对应）──
export interface ContentMismatch {
  title: string
  author?: string
  reason?: string
  dismissed?: boolean
}

/** title 只出现在错标的书上：认可 AI 判定时把书名改为正文书名 */
export type SuggestField = 'title' | 'author' | 'summary' | 'category'

export interface FieldSuggestion {
  value: string
  current: string | null
  confidence: AiFillConfidence
  evidence?: string
  locked?: boolean
}

export interface AiSuggestion {
  book_id: string
  title: string
  author: string | null
  cover_url: string | null
  created_at: string
  /** 填充批次号（每 500 本一批） */
  batch_no: number | null
  content_mismatch: ContentMismatch | null
  current: { recommended_tags: string[]; similar_works: SimilarWork[]; adaptations: BookAdaptation[] }
  data: {
    fields: Partial<Record<SuggestField, FieldSuggestion>>
    recommended_tags?: string[]
    similar_works?: SimilarWork[]
    adaptations?: BookAdaptation[]
  }
}

export interface AiSuggestionSelection {
  book_id: string
  fields: SuggestField[]
  tags: boolean
  similar: boolean
  adaptations: boolean
}


/** 待确认建议按填充批次的汇总 */
export interface AiSuggestionBatch {
  batch_no: number | null
  count: number
  mismatch_count: number
  /** 已交给后台采纳、处理中的本数 */
  applying: number
}

/** 后台采纳任务 */
export interface AiApplyJob {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  batch_no: number | null
  total: number
  done: number
  failed: number
  created_at: string
  finished_at: string | null
  error: string | null
}

/** 全书库 AI 填充进度 */
export interface AiFillStatus {
  total: number
  done: number
  remaining: number
  /** 没有封面的书（正常、非重复），可一键生成默认封面 */
  no_cover: number
  last_task: ScanTask | null
}

/** 后台任务通知（铃铛） */
export interface TaskNotice {
  id: string
  kind: string
  level: 'info' | 'success' | 'warning'
  title: string
  message: string | null
  /** 前端路由 */
  link: string | null
  /** resume_fill：显示「继续填充」 */
  action: 'resume_fill' | null
  created_at: string
  read_at: string | null
}
