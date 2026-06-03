export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  created_at: string;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  file_path: string;
  file_format: string;
  cover_url?: string;
  summary?: string;
  category?: string;
  tags?: string; // JSON array string
  publish_date?: string;
  finish_date?: string;
  is_finished: number;
  file_size?: number;
  imported_at: string;
  // 扫描增强字段（Plan 1）
  status?: 'normal' | 'duplicate' | 'garbled' | 'encoding_fixed';
  duplicate_of?: string | null;
  series_id?: string | null;
  chapter_count?: number;
  fingerprint?: string;
  first_chapter_hash?: string;
  encoding_detected?: string;
  manually_edited_fields?: string; // JSON array string
}

export interface ShelfItem {
  id: string;
  user_id: string;
  book_id: string;
  added_at: string;
  last_read_at?: string;
}

export interface ReadingProgress {
  id: string;
  user_id: string;
  book_id: string;
  chapter_index: number;
  chapter_title?: string;
  scroll_top: number;
  updated_at: string;
}

export interface Bookmark {
  id: string;
  user_id: string;
  book_id: string;
  chapter_index: number;
  scroll_top: number;
  note?: string;
  created_at: string;
}

export interface InviteCode {
  code: string;
  created_by?: string;
  used_by?: string;
  used_at?: string;
  expires_at?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data?: T;
  meta?: {
    requestId: string;
    timestamp: string;
  };
}

export interface PaginatedResponse<T> {
  success: boolean;
  code: string;
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface JwtPayload {
  userId: string;
  role: 'admin' | 'user';
}

export interface AiPlugin {
  name: string;
  label: string;
  fields: string[];
  placeholders?: Record<string, string>;
  fillBookInfo(rawText: string, config: Record<string, string>): Promise<Partial<Book>>;
  classifyBook(bookInfo: Partial<Book>, config: Record<string, string>): Promise<string>;
  /**
   * Low-level chat primitive. Used by AI dedup/series judgement.
   * Plugins must implement this so judgement logic can stay centralized.
   */
  chat(prompt: string, config: Record<string, string>): Promise<string>;
}

export interface ReaderPlugin {
  format: string;
  load(filePath: string): Promise<void>;
  getChapters(): Promise<Array<{ index: number; title: string }>>;
  getChapterContent(index: number): Promise<string>;
  getTotalProgress(): Promise<number>;
  getProgress(): Promise<number>;
}

export type ScanStage = 'walking' | 'fingerprinting' | 'dedup' | 'series' | 'staging' | 'ai_fill';

export interface ScanTask {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  stage: ScanStage | null;
  total_files: number;
  processed_files: number;
  options: string;            // JSON
  started_by: string;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
}

export interface ScanOptions {
  mode: 'auto' | 'review';
  ai_fill: boolean;
  full_rescan: boolean;
}

export interface Series {
  id: string;
  name: string;
  summary?: string;
  cover_url?: string;
  author?: string;
  created_at: string;
}

export type ScanBatchStatus = 'pending' | 'applied' | 'discarded';

export interface ScanBatch {
  id: string;
  task_id: string;
  status: ScanBatchStatus;
  summary_counts: string;   // JSON
  created_at: string;
  applied_at?: string | null;
  applied_by?: string | null;
  apply_summary?: string | null;  // JSON of ApplyResult (audit trail)
}

export type ScanBatchItemType =
  | 'new'
  | 'duplicate_group'
  | 'series'
  | 'garbled'
  | 'encoding_fixed'
  | 'ai_fill_failed';

export interface ScanBatchItem {
  id: string;
  batch_id: string;
  type: ScanBatchItemType;
  payload: string;          // JSON
  admin_decision?: 'accept' | 'reject' | 'modified' | null;
  admin_payload?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

export interface NewBookPayload {
  file_path: string;
  title: string;
  file_format: string;
  file_size: number;
  chapter_count?: number;
  fingerprint?: string;
  first_chapter_hash?: string;
  encoding_detected?: string;
  status?: 'normal' | 'encoding_fixed';
  file_mtime?: number;
  fingerprint_version?: number;
}

export interface DuplicateGroupPayload {
  canonical_file_path: string;        // 正本文件路径
  members: Array<{
    file_path: string;
    fingerprint: string;
    decision_type: 'hard' | 'ai';     // hard = 指纹完全相同；ai = AI 判定
    ai_confidence?: number;           // 0..1
  }>;
}

export interface SeriesGroupPayload {
  series_name: string;
  author?: string;
  members: Array<{
    file_path: string;
    sequence: number;
  }>;
  source: 'regex' | 'ai';
  confidence?: 'high' | 'medium' | 'low';
}

export interface GarbledPayload {
  file_path: string;
  reason: string;
}

export interface EncodingFixedPayload {
  file_path: string;
  from_encoding: string;
  to_encoding: 'utf-8';
}

export type ManualOverrideType =
  | 'not_duplicate'
  | 'not_in_series'
  | 'forced_duplicate'
  | 'forced_series_member';

export interface ManualOverride {
  id: string;
  type: ManualOverrideType;
  book_id_a: string | null;
  book_id_b: string | null;
  series_id: string | null;
  created_by: string;
  created_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

export type AuditAction =
  | 'delete_book_file'
  | 'delete_book_record'
  | 'apply_batch'
  | 'discard_batch'
  | 'create_manual_override'
  | 'delete_manual_override'
  | 'ai_fill_book'
  | 'ai_fetch_cover';

export interface AuditLog {
  id: string;
  user_id: string;
  action: AuditAction;
  resource_id?: string | null;
  file_path?: string | null;
  details?: string | null;
  created_at: string;
}

export interface BookAiMetadata {
  book_id: string;
  recommended_tags: string[];
  similar_works: Array<{ title: string; author?: string; reason?: string }>;
  generated_by?: string | null;
  generated_at: string;
}
