import { describe, it, expect } from 'vitest'
import { resolveBack } from './page-back'

describe('resolveBack', () => {
  it('back=true 且有站内历史：router.back', () => {
    expect(resolveBack(true, true, '/library')).toEqual({ type: 'back' })
  })
  it('back=true 无历史但有后备：跳后备路径', () => {
    expect(resolveBack(true, false, '/library')).toEqual({ type: 'push', path: '/library' })
  })
  it('back=true 无历史无后备：不显示', () => {
    expect(resolveBack(true, false)).toBeNull()
  })
  it('back 为字符串：直接跳转；未传：不显示', () => {
    expect(resolveBack('/x', false)).toEqual({ type: 'push', path: '/x' })
    expect(resolveBack(undefined, true)).toBeNull()
  })
})
