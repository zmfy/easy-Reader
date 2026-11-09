import type { AiSuggestion, AiSuggestionSelection, ContentMismatch, SuggestField } from '@/types'

export const SUGGEST_FIELDS: SuggestField[] = ['author', 'summary', 'category']
export const SUGGEST_FIELD_LABELS: Record<SuggestField, string> = { author: '作者', summary: '简介', category: '分类' }

/** 每本书在页面上的勾选状态 */
export interface SuggestionChoice {
  fields: Record<SuggestField, boolean>
  tags: boolean
  similar: boolean
  adaptations: boolean
}

/**
 * 默认勾选：依据明确 / 推断的字段勾上；低置信、手动改过（锁定）的不勾；标签、类似作品、改编作品有就勾。
 * 文件名与正文不符（错标）的书一律不勾：可能更想先改文件，而不是把信息换成正文那本书的
 */
export function defaultChoice(s: AiSuggestion): SuggestionChoice {
  const fields = { author: false, summary: false, category: false }
  if (s.content_mismatch) return { fields, tags: false, similar: false, adaptations: false }
  for (const f of SUGGEST_FIELDS) {
    const x = s.data.fields[f]
    fields[f] = !!x && x.confidence !== 'low' && !x.locked
  }
  return {
    fields,
    tags: !!s.data.recommended_tags?.length,
    similar: !!s.data.similar_works?.length,
    adaptations: !!s.data.adaptations?.length,
  }
}

export function hasSelection(c: SuggestionChoice): boolean {
  return SUGGEST_FIELDS.some(f => c.fields[f]) || c.tags || c.similar || c.adaptations
}

export function toSelection(s: AiSuggestion, c: SuggestionChoice): AiSuggestionSelection {
  return {
    book_id: s.book_id,
    fields: SUGGEST_FIELDS.filter(f => c.fields[f] && s.data.fields[f]),
    tags: c.tags && !!s.data.recommended_tags?.length,
    similar: c.similar && !!s.data.similar_works?.length,
    adaptations: c.adaptations && !!s.data.adaptations?.length,
  }
}

/** books.content_mismatch（JSON 字符串）→ 未被忽略的错标判定 */
export function parseContentMismatch(raw: string | null | undefined): ContentMismatch | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as ContentMismatch
    return m && typeof m.title === 'string' && !m.dismissed ? m : null
  } catch {
    return null
  }
}
