import http from './http'
import type { ApiResponse, Series, SeriesDetail } from '@/types'

export const seriesApi = {
  list: () => http.get<ApiResponse<Series[]>>('/library/series'),
  get: (id: string) => http.get<ApiResponse<SeriesDetail>>(`/library/series/${id}`),
  update: (id: string, payload: { name?: string; summary?: string; cover_url?: string }) =>
    http.put<ApiResponse<Series>>(`/library/series/${id}`, payload),
}
