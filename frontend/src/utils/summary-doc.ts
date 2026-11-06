import type { DocNode, SummarySource } from '@/types/study'

export const SOURCE_LABEL: Record<SummarySource, string> = {
  ai_generate: 'AI 生成',
  ai_update: 'AI 补充',
  user: '我',
  restore: '恢复',
}

/** 主题数 = 顶层 2 级标题数 */
export function countThemes(doc: DocNode): number {
  return (doc.content || []).filter(n => n.type === 'heading' && n.attrs?.level === 2).length
}
