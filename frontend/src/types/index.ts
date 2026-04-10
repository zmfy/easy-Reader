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

export interface ReaderSettings {
  fontFamily: string
  fontSize: number
  letterSpacing: number
  lineHeight: number
  theme: 'white' | 'eye-care' | 'night' | 'dark'
  backgroundColor: string
  fontColor: string
  pageMode: 'scroll' | 'flip'
}
