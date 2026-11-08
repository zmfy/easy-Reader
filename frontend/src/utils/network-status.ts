import { ref } from 'vue'

// 服务器连不上（请求没有拿到任何响应）：手机连着 Wi-Fi 但 NAS / 隧道不通时浏览器仍认为在线，
// 只看 navigator.onLine 不够，由接口请求的结果补充判断
export const serverUnreachable = ref(false)

export function reportNetworkError(): void { serverUnreachable.value = true }
export function reportNetworkOk(): void { serverUnreachable.value = false }

/** 请求没有拿到响应（断网、连不上、超时）；主动取消的不算 */
export function isNetworkFailure(err: unknown): boolean {
  const e = err as { isAxiosError?: boolean; response?: unknown; code?: string } | null
  return !!e?.isAxiosError && !e.response && e.code !== 'ERR_CANCELED'
}
