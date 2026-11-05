/** 与后端 strongPasswordSchema 一致的密码规则（管理员重置、自己改密码共用） */
export interface PasswordRules {
  minLen: boolean
  hasUpper: boolean
  hasLower: boolean
  hasNumber: boolean
  hasSpecial: boolean
  matched: boolean
}

export function passwordRules(password: string, confirm: string): PasswordRules {
  return {
    minLen: password.length >= 8 && password.length <= 100,
    hasUpper: /[A-Z]/.test(password),
    hasLower: /[a-z]/.test(password),
    hasNumber: /[0-9]/.test(password),
    hasSpecial: /[!@#$%^&*()\-_=+[\]{};':"\\|,.<>/?`~]/.test(password),
    matched: password.length > 0 && password === confirm,
  }
}

export function passwordValid(rules: PasswordRules): boolean {
  return Object.values(rules).every(Boolean)
}
