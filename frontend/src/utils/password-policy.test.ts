import { describe, it, expect } from 'vitest'
import { passwordRules, passwordValid } from './password-policy'

describe('passwordRules', () => {
  it('passes a strong password that is confirmed', () => {
    const r = passwordRules('Good#Pass1', 'Good#Pass1')
    expect(r).toEqual({ minLen: true, hasUpper: true, hasLower: true, hasNumber: true, hasSpecial: true, matched: true })
    expect(passwordValid(r)).toBe(true)
  })

  it.each([
    ['Go#d1', 'minLen'],
    ['good#pass1', 'hasUpper'],
    ['GOOD#PASS1', 'hasLower'],
    ['Good#Passx', 'hasNumber'],
    ['GoodPass12', 'hasSpecial'],
  ] as const)('flags %p as failing %s', (pw, rule) => {
    const r = passwordRules(pw, pw)
    expect(r[rule]).toBe(false)
    expect(passwordValid(r)).toBe(false)
  })

  it('requires the confirmation to match and not be empty', () => {
    expect(passwordRules('Good#Pass1', 'Good#Pass2').matched).toBe(false)
    expect(passwordRules('', '').matched).toBe(false)
  })

  it('rejects the default admin password', () => {
    expect(passwordValid(passwordRules('admin123', 'admin123'))).toBe(false)
  })
})
