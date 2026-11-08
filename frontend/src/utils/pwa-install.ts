// 「安装到桌面」：根据当前环境决定点击后做什么

export type InstallMode = 'installed' | 'prompt' | 'ios' | 'insecure' | 'unsupported'

export interface InstallEnv {
  /** 已从桌面图标打开（display-mode: standalone / iOS navigator.standalone） */
  standalone: boolean
  /** 安全上下文（HTTPS 或 localhost） */
  secure: boolean
  /** 浏览器给了安装提示事件（beforeinstallprompt） */
  hasPrompt: boolean
  ua: string
  maxTouchPoints: number
}

export function installMode(env: InstallEnv): InstallMode {
  if (env.standalone) return 'installed'
  if (!env.secure) return 'insecure'
  if (env.hasPrompt) return 'prompt'
  // iPadOS 默认伪装成 Mac：用触点数区分
  const ios = /iPhone|iPad|iPod/.test(env.ua) || (/Macintosh/.test(env.ua) && env.maxTouchPoints > 1)
  return ios ? 'ios' : 'unsupported'
}
