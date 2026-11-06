// 铃铛红点计数：每条本机配置警告计 1；有比本站新的版本计 1（不论差几个版本）。
// 打开面板即视为看过（localStorage 记最新版本号）：普通新版本看过后不再计数，直到出现更新的版本；
// 未升级的新版本中含【需操作】时一直计数，升级后自动消失。
const KEY = 'update-notice-seen'

export interface NoticeCountInput {
  configWarnings: number
  latestVersion: string | null
  actionRequired: boolean
}

function seenVersion(store: Storage): string | null {
  try {
    return store.getItem(KEY)
  } catch {
    return null
  }
}

export function unreadCount(input: NoticeCountInput, store: Storage): number {
  let count = input.configWarnings
  if (input.latestVersion && (input.actionRequired || seenVersion(store) !== input.latestVersion)) count += 1
  return count
}

export function markSeen(latestVersion: string, store: Storage): void {
  try {
    store.setItem(KEY, latestVersion)
  } catch { /* 存储不可用时本次不记忆 */ }
}
