import { describe, it, expect } from 'vitest'
import { isNetworkFailure, serverUnreachable, reportNetworkError, reportNetworkOk } from './network-status'

describe('network-status', () => {
  it('isNetworkFailure is true only for requests that never got a response', () => {
    expect(isNetworkFailure({ isAxiosError: true, code: 'ERR_NETWORK' })).toBe(true)
    expect(isNetworkFailure({ isAxiosError: true, code: 'ECONNABORTED' })).toBe(true)
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
