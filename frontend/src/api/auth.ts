import http from './http'
import type { ApiResponse, User } from '@/types'

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  password: string
  inviteCode?: string
}

export interface AuthData {
  user: User
  accessToken: string
  refreshToken: string
}

export const authApi = {
  login: (payload: LoginPayload) =>
    http.post<ApiResponse<AuthData>>('/auth/login', payload),

  logout: () =>
    http.post<ApiResponse<null>>('/auth/logout'),

  register: (payload: RegisterPayload) =>
    http.post<ApiResponse<AuthData>>('/auth/register', payload),

  me: () =>
    http.get<ApiResponse<User>>('/auth/me'),
}
