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
}

export interface ReaderPlugin {
  format: string;
  load(filePath: string): Promise<void>;
  getChapters(): Promise<Array<{ index: number; title: string }>>;
  getChapterContent(index: number): Promise<string>;
  getTotalProgress(): Promise<number>;
  getProgress(): Promise<number>;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}
