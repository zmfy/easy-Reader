import { describe, it, expect } from 'vitest'
import { workboxOptions } from './workbox-options'

describe('workboxOptions', () => {
  it('workbox config excludes api, covers, manifest and pdfjs', () => {
    const deny = workboxOptions.navigateFallbackDenylist
    for (const p of ['/api/v1/auth/me', '/api/reader/x', '/covers/a.jpg', '/manifest.webmanifest', '/health']) {
      expect(deny.some(r => r.test(p))).toBe(true)
    }
    for (const p of ['/continue', '/reader/abc', '/library', '/apiary']) expect(deny.some(r => r.test(p))).toBe(false)
    expect(workboxOptions.globIgnores).toContain('pdfjs/**')
    expect(workboxOptions.navigateFallback).toBe('index.html')
    expect('runtimeCaching' in workboxOptions).toBe(false)
  })
})
