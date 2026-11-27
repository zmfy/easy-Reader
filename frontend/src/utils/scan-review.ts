import type { OrganizeDecision, ScanBatchItem } from '@/types'

/** 还没选「导入 / 跳过」的损坏书本数：有未决定项时批次不能应用 */
export function undecidedDamagedCount(items: ScanBatchItem[]): number {
  return items.filter(i => i.type === 'damaged' && !i.admin_decision).length
}

/** 整理审核的四种决定（顺序即界面上的顺序，第一个是默认） */
export const ORGANIZE_DECISION_LABELS: Record<OrganizeDecision, string> = {
  keep_new_hide_old: '保留整理版，原书隐藏为副本',
  keep_new_delete_record: '保留整理版，删除原书记录（保留文件，以后扫描跳过）',
  keep_new_delete_file: '保留整理版，连原文件一起删除',
  keep_old: '保留原书，删除整理版',
}

/** 整理审核项上管理员的选择：admin_payload.decision；没选时「拒绝」= 保留原书，其余默认 keep_new_hide_old（同后端 organizeDecisionOf） */
export function organizeDecisionOf(item: Pick<ScanBatchItem, 'admin_decision' | 'admin_payload'>): OrganizeDecision {
  try {
    const d = item.admin_payload ? (JSON.parse(item.admin_payload) as { decision?: unknown }).decision : undefined
    if (typeof d === 'string' && d in ORGANIZE_DECISION_LABELS) return d as OrganizeDecision
  } catch { /* 损坏的 admin_payload 按未选择处理 */ }
  return item.admin_decision === 'reject' ? 'keep_old' : 'keep_new_hide_old'
}
