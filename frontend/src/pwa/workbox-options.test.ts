import { describe, it, expect } from 'vitest'
import { workboxOptions } from './workbox-options'

describe('workboxOptions', () => {
  it('OPDS 书目源与下载不走 Service Worker（浏览器里打开书目地址要看到登录框和 XML）', () => {
    const deny = workboxOptions.navigateFallbackDenylist
    for (const p of ['/opds', '/opds/all', '/opds/books/b1/download.epub']) expect(deny.some(r => r.test(p))).toBe(true)
    // 网页里的「阅读 App（OPDS）」页面仍由应用处理
    expect(deny.some(r => r.test('/opds-access'))).toBe(false)
  })

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
