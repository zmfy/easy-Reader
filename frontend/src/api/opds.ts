import http from './http'
import type { ApiResponse } from '@/types'

export interface OpdsStatus {
  enabled: boolean
  created_at: string | null
  last_used_at: string | null
  username: string
}

/** OPDS 书目源的专用密码：阅读 App 用用户名 + 这个密码连接，不是登录密码 */
export const opdsApi = {
  status: () => http.get<ApiResponse<OpdsStatus>>('/opds/credentials'),

  /** 开通或重置，需要再输入一次登录密码；返回的密码只出现这一次 */
  issue: (currentPassword: string) =>
    http.post<ApiResponse<{ password: string; username: string }>>('/opds/credentials', { currentPassword }),

  disable: () => http.delete<ApiResponse<null>>('/opds/credentials'),
}
