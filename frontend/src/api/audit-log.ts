import http from './http'
import type { ApiResponse, AuditLog, AuditAction } from '@/types'

export const auditLogApi = {
  list: (params: { action?: AuditAction; user_id?: string; limit?: number; offset?: number } = {}) =>
    http.get<ApiResponse<{ logs: AuditLog[]; total: number }>>('/library/audit-log', { params }),
}
