import http from './http'
import type { ApiResponse, ReaderSettings, Release, UpdateStatus } from '@/types'

export const settingsApi = {
  getPublic: () =>
    http.get<ApiResponse<{ site_name: string; site_subtitle: string; site_theme: string }>>('/settings/public'),

  get: () =>
    http.get<ApiResponse<Record<string, string>>>('/settings'),

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
