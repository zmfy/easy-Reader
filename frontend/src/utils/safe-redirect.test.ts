import { describe, it, expect } from 'vitest'
import { safeRedirect, loginRedirectFor, loginHrefFor } from './safe-redirect'

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
  it('loginHrefFor builds the full-page login URL used when a session expires mid-request', () => {
    expect(loginHrefFor('/continue')).toBe('/login?redirect=%2Fcontinue')
    expect(loginHrefFor('/reader/b1?chapter=2#x')).toBe('/login?redirect=%2Freader%2Fb1%3Fchapter%3D2%23x')
    expect(loginHrefFor('/library')).toBe('/login')
    expect(loginHrefFor('/login?redirect=%2Fcontinue')).toBe('/login?redirect=%2Fcontinue')
  })
})
