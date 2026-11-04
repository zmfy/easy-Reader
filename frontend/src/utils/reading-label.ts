import type { ReadingProgress } from '@/types'

/** 书页阅读按钮文字：读过的书提示从哪一章继续 */
export function readButtonLabel(progress: ReadingProgress | null | undefined): string {
  if (!progress?.hasProgress) return '开始阅读'
  return `继续阅读 · ${progress.chapterTitle || `第 ${progress.chapterIndex + 1} 章`}`
}
