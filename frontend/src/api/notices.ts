import http from './http'
import type { ApiResponse, TaskNotice } from '@/types'

// 后台任务通知（铃铛，管理员）
export const noticesApi = {
  list: () => http.get<ApiResponse<{ items: TaskNotice[]; unread: number }>>('/notices'),
  markRead: (id: string) => http.post<ApiResponse<{ read: number }>>(`/notices/${id}/read`, {}),
  markAllRead: () => http.post<ApiResponse<{ read: number }>>('/notices/read-all', {}),
}
