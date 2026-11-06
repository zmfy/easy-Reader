import http from './http'
import type { ApiResponse } from '@/types'
import type {
  DocNode, StudySummary, SummaryDetail, SummaryMarkdownDetail, SummaryJob, SummaryOverview,
  SummaryVersion, SummaryVersionDetail, ResolvedRef,
} from '@/types/study'

export const studyApi = {
  listSummaries: (q?: string) =>
    http.get<ApiResponse<SummaryOverview[]>>('/study/summaries', { params: q ? { q } : undefined }),

  getSummary: (bookId: string) =>
    http.get<ApiResponse<SummaryDetail>>(`/study/books/${bookId}/summary`),

  getSummaryMarkdown: (bookId: string) =>
    http.get<ApiResponse<SummaryMarkdownDetail>>(`/study/books/${bookId}/summary`, { params: { format: 'markdown' } }),

  // 409 时 error.response.data.data 为最新 summary
  saveSummary: (bookId: string, doc: DocNode, revision: number) =>
    http.put<ApiResponse<StudySummary>>(`/study/books/${bookId}/summary`, { doc, revision }),

  deleteSummary: (bookId: string) =>
    http.delete<ApiResponse<{ deleted: boolean }>>(`/study/books/${bookId}/summary`),

  startJob: (bookId: string, kind: 'generate' | 'update') =>
    http.post<ApiResponse<SummaryJob>>(`/study/books/${bookId}/summary/jobs`, { kind }),

  currentJob: (bookId: string) =>
    http.get<ApiResponse<SummaryJob | null>>(`/study/books/${bookId}/summary/jobs/current`),

  listVersions: (bookId: string) =>
    http.get<ApiResponse<SummaryVersion[]>>(`/study/books/${bookId}/summary/versions`),

  getVersion: (bookId: string, id: string) =>
    http.get<ApiResponse<SummaryVersionDetail>>(`/study/books/${bookId}/summary/versions/${id}`),

  restoreVersion: (bookId: string, versionId: string, revision: number) =>
    http.post<ApiResponse<StudySummary>>(`/study/books/${bookId}/summary/versions/${versionId}/restore`, { revision }),

  resolveRef: (bookId: string, ref: string) =>
    http.get<ApiResponse<ResolvedRef>>(`/study/books/${bookId}/refs/${encodeURIComponent(ref)}`),
}
