import http from './http'
import type { ApiResponse, ScanBatch, ScanBatchItem, OrganizeApplySummary } from '@/types'

export const scanBatchesApi = {
  list: (status?: 'pending' | 'applied' | 'discarded') =>
    http.get<ApiResponse<ScanBatch[]>>('/library/scan-batches', { params: { status } }),

  get: (id: string) =>
    http.get<ApiResponse<{ batch: ScanBatch; items: ScanBatchItem[] }>>(`/library/scan-batches/${id}`),

  updateItem: (batchId: string, itemId: string, decision: 'accept' | 'reject' | 'modified', payload?: unknown) =>
    http.patch<ApiResponse<null>>(`/library/scan-batches/${batchId}/items/${itemId}`, { decision, payload }),

  // 整理审核批次（kind='organize'）返回 OrganizeApplySummary，其余返回扫描的应用结果
  apply: (id: string) =>
    http.post<ApiResponse<OrganizeApplySummary | {
      inserted: number
      updated: number
      duplicates_linked: number
      series_created: number
      garbled_marked: number
      damaged_imported: number
      damaged_skipped: number
      errors: Array<{ item_id: string; message: string }>
    }>>(`/library/scan-batches/${id}/apply`),

  discard: (id: string) =>
    http.delete<ApiResponse<null>>(`/library/scan-batches/${id}`),

  preview: (id: string, filePath: string) =>
    http.get<ApiResponse<{ content: string }>>(`/library/scan-batches/${id}/preview`, {
      params: { file_path: filePath },
    }),
}
