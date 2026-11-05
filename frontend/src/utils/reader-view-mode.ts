/**
 * 阅读器「查看模式」：从学习导图跳转打开（?chapter / ?highlight）时只浏览原文，
 * 不保存任何阅读进度，避免回看前面章节的笔记把「继续阅读」位置拉回去。
 * 只有顶部提示条的两个按钮能退出查看模式。
 */
export type ProgressMode = 'normal' | 'view-only'
export type ViewOnlyExit = 'continue-here' | 'back-to-saved'

/** 打开阅读器时的模式：只有有效的跳转目标才进入查看模式 */
export function openingProgressMode(hasValidJumpTarget: boolean): ProgressMode {
  return hasValidJumpTarget ? 'view-only' : 'normal'
}

/** 当前模式下是否允许保存阅读进度（滚动、翻章、切走页面、离开阅读器等所有保存途径） */
export function canSaveProgress(mode: ProgressMode): boolean {
  return mode === 'normal'
}

/** 退出查看模式：「从这里继续读」立即把当前位置存为进度；「回到上次进度」恢复已保存的位置 */
export function exitViewOnly(action: ViewOnlyExit): { mode: ProgressMode; saveCurrent: boolean; restoreSaved: boolean } {
  return { mode: 'normal', saveCurrent: action === 'continue-here', restoreSaved: action === 'back-to-saved' }
}
