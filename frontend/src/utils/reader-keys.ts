export type ReaderKeyAction = 'prevChapter' | 'nextChapter' | 'pageDown' | 'pageUp' | 'bookmark'

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>

/** 阅读器键盘快捷键：← / → 翻章，空格 / PageDown 下翻一屏（Shift+空格 / PageUp 上翻），B 加书签 */
export function readerKeyAction(e: KeyLike): ReaderKeyAction | null {
  // 带 Ctrl / Alt / Meta 的组合键留给浏览器（如 Alt+← 后退）
  if (e.ctrlKey || e.altKey || e.metaKey) return null
  switch (e.key) {
    case 'ArrowLeft': return 'prevChapter'
    case 'ArrowRight': return 'nextChapter'
    case ' ': return e.shiftKey ? 'pageUp' : 'pageDown'
    case 'PageDown': return 'pageDown'
    case 'PageUp': return 'pageUp'
    case 'b':
    case 'B': return 'bookmark'
    default: return null
  }
}
