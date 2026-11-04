import type { AiFillApplyInput, AiFillLockableField, AiFillPreview, SimilarWork } from '@/types'

/** AI 填充预览弹窗的表单状态 */
export interface AiFillForm {
  author: string
  summary: string
  category: string
  is_finished: boolean | null
  /** 锁定字段是否改用 AI 结果（非锁定字段不使用） */
  useAi: Record<AiFillLockableField, boolean>
  tags: string[]
  similar: SimilarWork[]
  /** 'current' = 保留当前封面，'default' = 系统默认封面，数字 = 豆瓣候选的下标 */
  cover: 'current' | 'default' | number
}

const FIELDS: AiFillLockableField[] = ['author', 'summary', 'category']

/**
 * 初始化表单：
 * - 非锁定字段用 AI 建议，AI 没给时保留当前值；
 * - 锁定字段默认保留当前值，当前值为空时用 AI 建议；
 * - 标签、类似作品用 AI 结果，AI 为空时保留当前内容（避免直接应用就清空）；
 * - 封面优先当前封面，其次第一个豆瓣候选，最后默认封面。
 */
export function initialForm(p: AiFillPreview): AiFillForm {
  const locked = new Set(p.lockedFields)
  const useAi = { author: false, summary: false, category: false }
  const values = { author: '', summary: '', category: '' }
  for (const f of FIELDS) {
    const current = p.current[f] || ''
    const suggestion = p.suggested[f] || ''
    if (locked.has(f)) {
      useAi[f] = !current && !!suggestion
      values[f] = useAi[f] ? suggestion : current
    } else {
      values[f] = suggestion || current
    }
  }
  const tags = p.suggested.recommended_tags.length > 0 ? p.suggested.recommended_tags : p.current.recommended_tags
  const similar = p.suggested.similar_works.length > 0 ? p.suggested.similar_works : p.current.similar_works
  return {
    ...values,
    is_finished: p.suggested.is_finished ?? p.current.is_finished,
    useAi,
    tags: [...tags],
    similar: similar.map(s => ({ ...s })),
    cover: p.current.cover_url ? 'current' : p.coverCandidates.length > 0 ? 0 : 'default',
  }
}

export function buildApplyPayload(form: AiFillForm, p: AiFillPreview): AiFillApplyInput {
  const chosen = typeof form.cover === 'number' ? p.coverCandidates[form.cover] : undefined
  const ratingSubjectUrl = chosen ? chosen.subjectUrl : p.coverCandidates[0]?.subjectUrl
  return {
    author: form.author,
    summary: form.summary,
    category: form.category,
    ...(form.is_finished === null ? {} : { is_finished: form.is_finished }),
    recommended_tags: [...form.tags],
    similar_works: form.similar.map(s => ({ ...s })),
    cover: chosen ? { type: 'douban', pic: chosen.pic } : form.cover === 'default' ? { type: 'default' } : { type: 'keep' },
    ...(ratingSubjectUrl ? { ratingSubjectUrl } : {}),
    coverTitle: p.coverTitle,
    suggested: { author: p.suggested.author, summary: p.suggested.summary, category: p.suggested.category },
  }
}
