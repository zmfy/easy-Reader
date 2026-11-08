import { describe, it, expect } from 'vitest'
import { safeRedirect, loginRedirectFor } from './safe-redirect'

describe('safe-redirect', () => {
  it('safeRedirect rejects external targets', () => {
    expect(safeRedirect('/continue')).toBe('/continue')
    expect(safeRedirect('/reader/abc?x=1')).toBe('/reader/abc?x=1')
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '', undefined, ['/a'], 'continue']) {
      expect(safeRedirect(bad)).toBe('/library')
    }
  })

  it('guard sends unauthenticated users to login with redirect', () => {
    expect(loginRedirectFor('/continue')).toEqual({ path: '/login', query: { redirect: '/continue' } })
    expect(loginRedirectFor('/reader/b1?chapter=2')).toEqual({ path: '/login', query: { redirect: '/reader/b1?chapter=2' } })
    expect(loginRedirectFor('/library')).toEqual({ path: '/login' })
    expect(loginRedirectFor('/')).toEqual({ path: '/login' })
  })
})
