import http from './http'
import type { ApiResponse, ScanBatch, ScanBatchItem } from '@/types'

export const scanBatchesApi = {
  list: (status?: 'pending' | 'applied' | 'discarded') =>
    http.get<ApiResponse<ScanBatch[]>>('/library/scan-batches', { params: { status } }),

  get: (id: string) =>
    http.get<ApiResponse<{ batch: ScanBatch; items: ScanBatchItem[] }>>(`/library/scan-batches/${id}`),

  updateItem: (batchId: string, itemId: string, decision: 'accept' | 'reject' | 'modified', payload?: unknown) =>
    http.patch<ApiResponse<null>>(`/library/scan-batches/${batchId}/items/${itemId}`, { decision, payload }),

  apply: (id: string) =>
    http.post<ApiResponse<{
      inserted: number
      updated: number
      duplicates_linked: number
      series_created: number
      garbled_marked: number
      errors: Array<{ item_id: string; message: string }>
    }>>(`/library/scan-batches/${id}/apply`),

  discard: (id: string) =>
    http.delete<ApiResponse<null>>(`/library/scan-batches/${id}`),

  preview: (id: string, filePath: string) =>
    http.get<ApiResponse<{ content: string }>>(`/library/scan-batches/${id}/preview`, {
      params: { file_path: filePath },
    }),
}
