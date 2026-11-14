import type { LookupStep } from '@/types'

const SEARCH_LABELS = { search_book: '豆瓣书', search_movie: '豆瓣影视', search_drama: '猫耳' } as const

/** 查证过程中一步操作的中文描述（进度与「查证过程」共用） */
export function lookupStepText(step: LookupStep): string {
  switch (step.kind) {
    case 'search_book':
    case 'search_movie':
    case 'search_drama':
      return `搜${SEARCH_LABELS[step.kind]}「${step.query}」→ ${step.error ? '出错' : `${step.count} 条`}`
    case 'open_book':
      return `打开 ${step.label}`
    case 'confirm_book':
      return `确认：${step.label}${step.why ? `（${step.why}）` : ''}`
    case 'no_book':
      return `豆瓣没有这本书${step.why ? `（${step.why}）` : ''}`
    case 'pick_adaptations':
      return `选出 ${step.count} 个改编`
    case 'invalid':
      return 'AI 回答无法识别'
  }
}
