export type ReaderKeyAction = 'prevChapter' | 'nextChapter' | 'pageDown' | 'pageUp' | 'bookmark'

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>

/** 阅读器键盘快捷键：← / → 翻章；↓ / 空格 / PageDown 下翻一屏（↑ / Shift+空格 / PageUp 上翻）；B 加书签 */
export function readerKeyAction(e: KeyLike): ReaderKeyAction | null {
  // 带 Ctrl / Alt / Meta 的组合键留给浏览器（如 Alt+← 后退）
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  switch (e.key) {
    case 'ArrowLeft': return 'prevChapter'
    case 'ArrowRight': return 'nextChapter'
    case 'ArrowDown': return 'pageDown'
    case 'ArrowUp': return 'pageUp'
    case ' ': return e.shiftKey ? 'pageUp' : 'pageDown'
    case 'PageDown': return 'pageDown'
    case 'PageUp': return 'pageUp'
    case 'b':
    case 'B': return 'bookmark'
    default: return null
  }
}

/**
 * 按屏翻页的滚动距离：一屏高度减去两行正文，翻页后上一屏最后两行出现在新一屏顶部，阅读不脱节。
 * 视口很小时至少滚动半屏，避免几乎不动。
 */
export function pageScrollDistance(viewportHeight: number, lineHeightPx: number): number {
  return Math.max(viewportHeight - lineHeightPx * 2, viewportHeight / 2)
}

/**
 * 按行对齐的下翻距离：把「距屏幕底部约两行」的那一行滚到屏幕顶部（留 8px 边距），
 * 保证翻页后至少两整行与上一屏重叠、顶部不出现被切掉半截的行。限制在半屏到一屏之间。
 */
export function alignedPageDistance(targetLineTop: number, viewportTop: number, viewportHeight: number): number {
  const distance = targetLineTop - viewportTop - 8
  return Math.min(Math.max(distance, viewportHeight / 2), viewportHeight)
}

export type TapZoneAction = 'pageUp' | 'pageDown' | 'toggle'

/** 点按翻页：点屏幕左侧 30% 上翻一屏、右侧 30% 下翻一屏，中间呼出 / 收起菜单 */
export function tapZoneAction(x: number, width: number): TapZoneAction {
  if (width <= 0) return 'toggle'
  const ratio = x / width
  if (ratio < 0.3) return 'pageUp'
  if (ratio >= 0.7) return 'pageDown'
  return 'toggle'
}

/** 正文点击：开启「点击翻页」时按点的位置翻页，关闭时点哪里都只呼出 / 收起菜单（所有主题通用） */
export function contentTapAction(x: number, width: number, tapPaging: boolean): TapZoneAction {
  return tapPaging ? tapZoneAction(x, width) : 'toggle'
}
