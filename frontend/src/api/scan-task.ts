import http from './http'
import type { ApiResponse, ScanTask, ScanStartOptions } from '@/types'

export const scanTaskApi = {
  start: (payload: ScanStartOptions) =>
    http.post<ApiResponse<{ taskId: string; status: string }>>('/library/scan', payload),

  getActive: () =>
    http.get<ApiResponse<ScanTask | null>>('/library/scan/tasks/active'),

  getById: (id: string) =>
    http.get<ApiResponse<ScanTask>>(`/library/scan/tasks/${id}`),

  cancel: (id: string) =>
    http.post<ApiResponse<null>>(`/library/scan/tasks/${id}/cancel`),
}
