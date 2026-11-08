import { describe, it, expect } from 'vitest'
import { isNetworkFailure, serverUnreachable, reportNetworkError, reportNetworkOk } from './network-status'

describe('network-status', () => {
  it('isNetworkFailure is true only for requests that never got a response', () => {
    expect(isNetworkFailure({ isAxiosError: true, code: 'ERR_NETWORK' })).toBe(true)
    // 超时 / 页面卸载时中止：服务器可能连得上（如 AI 生成很慢），不算断网
    expect(isNetworkFailure({ isAxiosError: true, code: 'ECONNABORTED' })).toBe(false)
    expect(isNetworkFailure({ isAxiosError: true, code: 'ETIMEDOUT' })).toBe(false)
    expect(isNetworkFailure({ isAxiosError: true, response: { status: 500 } })).toBe(false)
    expect(isNetworkFailure({ isAxiosError: true, code: 'ERR_CANCELED' })).toBe(false)
    expect(isNetworkFailure(new Error('x'))).toBe(false)
  })

  it('tracks whether the server is unreachable', () => {
    reportNetworkError()
    expect(serverUnreachable.value).toBe(true)
    reportNetworkOk()
    expect(serverUnreachable.value).toBe(false)
  })
})
