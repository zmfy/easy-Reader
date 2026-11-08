import { describe, it, expect } from 'vitest'
import { installMode } from './pwa-install'

const base = { standalone: false, secure: true, hasPrompt: false, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', maxTouchPoints: 0 }

describe('installMode', () => {
  it('installMode picks the right branch in order', () => {
    expect(installMode({ ...base, standalone: true, secure: false })).toBe('installed')
    expect(installMode({ ...base, secure: false, hasPrompt: true })).toBe('insecure')
    expect(installMode({ ...base, hasPrompt: true })).toBe('prompt')
    expect(installMode({ ...base, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' })).toBe('ios')
    expect(installMode({ ...base, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 })).toBe('ios')
    expect(installMode({ ...base, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605' })).toBe('unsupported')
    // Chrome / Edge 没给安装提示（取消过一次、或已安装后在普通标签页打开）：引导用浏览器菜单，而不是让用户「改用 Chrome」
    expect(installMode({ ...base })).toBe('menu')
    expect(installMode({ ...base, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36 EdgA/130' })).toBe('menu')
    expect(installMode({ ...base, ua: 'Mozilla/5.0 (X11; Linux) Firefox/130' })).toBe('unsupported')
  })
})
