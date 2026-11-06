export interface DocNode {
  type: string
  attrs?: Record<string, unknown>
  content?: DocNode[]
  text?: string
  marks?: Array<{ type: string }>
}

export type SummarySource = 'ai_generate' | 'ai_update' | 'user' | 'restore'

export interface SummaryJob {
  id: string
  book_id: string
  kind: 'generate' | 'update'
  status: 'running' | 'done' | 'failed'
  done: number
  total: number
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface StudySummary {
  id: string
  book_id: string
  doc: DocNode
  included_refs: string[]
  revision: number
  created_at: string
  updated_at: string
}

/** GET /study/books/:bookId/summary（format=json）的返回 */
export interface SummaryDetail {
  summary: StudySummary | null
  bookTitle: string | null
  noteCount: number
  newNoteCount: number
  job: SummaryJob | null
}

/** GET /study/books/:bookId/summary?format=markdown 的返回 */
export interface SummaryMarkdownDetail extends Omit<SummaryDetail, 'summary'> {
  summary: (Omit<StudySummary, 'doc'> & { markdown: string }) | null
}

export interface SummaryOverview {
  bookId: string
  bookTitle: string | null
  hasSummary: boolean
  themes: string[]
  noteCount: number
  newNoteCount: number
  updatedAt: string | null
  lastSource: SummarySource | null
  job: SummaryJob | null
}

export interface SummaryVersion {
  id: string
  source: SummarySource
  description: string
  created_at: string
  updated_at: string
}

export interface SummaryVersionDetail {
  id: string
  doc: DocNode
  source: SummarySource
  description: string
  updated_at: string
}

export type ResolvedRef =
  | { exists: false }
  | {
    exists: true
    type: 'highlight' | 'node'
    text: string
    target: { highlight: string } | { chapter: number; find?: string }
    later: boolean
    canOpen: boolean
  }
