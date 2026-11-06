// 系统提示条「新版本」的关闭记录：按最新版本号记。
// 普通版本记在 localStorage（永久不再提示）；含【需操作】的版本记在 sessionStorage（仅本次会话）。
const KEY = 'update-notice-dismissed'

export interface NoticeStore {
  local: Storage
  session: Storage
}

function pick(actionRequired: boolean, store: NoticeStore): Storage {
  return actionRequired ? store.session : store.local
}

export function isDismissed(version: string, actionRequired: boolean, store: NoticeStore): boolean {
  try {
    return pick(actionRequired, store).getItem(KEY) === version
  } catch {
    return false
  }
}

export function dismiss(version: string, actionRequired: boolean, store: NoticeStore): void {
  try {
    pick(actionRequired, store).setItem(KEY, version)
  } catch { /* 存储不可用时本次不记忆 */ }
}
