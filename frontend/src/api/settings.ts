import http from './http'
import type { ApiResponse, ReaderSettings } from '@/types'

export const settingsApi = {
  getPublic: () =>
    http.get<ApiResponse<{ site_name: string; site_theme: string }>>('/settings/public'),

  get: () =>
    http.get<ApiResponse<Record<string, string>>>('/settings'),

  update: (settings: Record<string, string>) =>
    http.put<ApiResponse<null>>('/settings', settings),

  getAiPlugins: () =>
    http.get<ApiResponse<Array<{ name: string; label: string; fields: string[] }>>>('/settings/ai-plugins'),

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

  changeUserPassword: (id: string, password: string) =>
    http.put<ApiResponse<null>>(`/settings/users/${id}/password`, { password }),

  getReaderPrefs: () =>
    http.get<ApiResponse<ReaderSettings | null>>('/settings/reader-prefs'),

  saveReaderPrefs: (settings: ReaderSettings) =>
    http.put<ApiResponse<null>>('/settings/reader-prefs', settings),
}
