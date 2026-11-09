import http from './http'
import type { ApiResponse, ReaderSettings, Release, UpdateStatus } from '@/types'

export const settingsApi = {
  // HTTPS（使用自己的证书，管理员）：只返回证书元数据
  getHttps: () => http.get<ApiResponse<import('@/types').HttpsStatus>>('/settings/https'),
  uploadHttps: (cert: string, key: string) =>
    http.put<ApiResponse<import('@/types').HttpsStatus>>('/settings/https', { cert, key }),
  deleteHttps: () => http.delete<ApiResponse<import('@/types').HttpsStatus>>('/settings/https'),
  setHttpsEnabled: (enabled: boolean) =>
    http.put<ApiResponse<import('@/types').HttpsStatus>>('/settings/https/enabled', { enabled }),

  getPublic: () =>
    http.get<ApiResponse<{ site_name: string; site_subtitle: string; site_theme: string }>>('/settings/public'),

  get: () =>
    http.get<ApiResponse<Record<string, string>>>('/settings'),

  // 保存分类树；renames 把书的分类按前缀改名
  saveCategoryTree: (tree: import('@/types').CategoryNode[], renames: Array<{ from: string; to: string }>) =>
    http.put<ApiResponse<{ tree: import('@/types').CategoryNode[]; renamed: number }>>('/settings/category-tree', { tree, renames }),

  update: (settings: Record<string, string>) =>
    http.put<ApiResponse<null>>('/settings', settings),

  getAiPlugins: () =>
    http.get<ApiResponse<Array<{ name: string; label: string; fields: string[]; placeholders?: Record<string, string>; options?: Record<string, Array<{ value: string; label: string }>> }>>>('/settings/ai-plugins'),

  getAiStatus: () =>
    http.get<ApiResponse<{ configured: boolean; active_plugin: string | null; tts_enabled?: boolean; config_warning?: string | null }>>('/settings/ai-status'),

  getReaderPlugins: () =>
    http.get<ApiResponse<Array<{ format: string; label: string; description: string }>>>('/settings/reader-plugins'),

  getUsers: () =>
    http.get<ApiResponse<Array<{ id: string; username: string; role: string; created_at: string }>>>('/settings/users'),

  createInvite: () =>
    http.post<ApiResponse<{ code: string; expiresAt: string }>>('/settings/users/invite'),

  sendInviteEmail: (email: string, code: string, inviteUrl: string) =>
    http.post<ApiResponse<null>>('/settings/users/invite/send-email', { email, code, inviteUrl }),

  updateUserRole: (id: string, role: string) =>
    http.put<ApiResponse<null>>(`/settings/users/${id}/role`, { role }),

  deleteUser: (id: string) =>
    http.delete<ApiResponse<null>>(`/settings/users/${id}`),

  changeUserPassword: (id: string, password: string) =>
    http.put<ApiResponse<null>>(`/settings/users/${id}/password`, { password }),

  getReaderPrefs: () =>
    http.get<ApiResponse<ReaderSettings | null>>('/settings/reader-prefs'),

  saveReaderPrefs: (settings: ReaderSettings) =>
    http.put<ApiResponse<null>>('/settings/reader-prefs', settings),

  getUpdateStatus: () =>
    http.get<ApiResponse<UpdateStatus>>('/settings/update-status'),

  // 「系统提醒」开关：走 PUT /settings 保存，后端据此启停后台更新检查
  setSystemNotice: (enabled: boolean) =>
    http.put<ApiResponse<null>>('/settings', { system_notice_enabled: enabled ? 'true' : 'false' }),

  setUsageStats: (enabled: boolean) =>
    http.put<ApiResponse<null>>('/settings', { usage_stats_enabled: enabled ? 'true' : 'false' }),

  checkUpdates: () =>
    http.post<ApiResponse<UpdateStatus>>('/settings/update-check', {}),

  getChangelog: () =>
    http.get<ApiResponse<{ currentVersion: string | null; missing: boolean; releases: Release[] }>>('/settings/changelog'),
}
