import type { ScanBatchItem } from '@/types'

/** 还没选「导入 / 跳过」的损坏书本数：有未决定项时批次不能应用 */
export function undecidedDamagedCount(items: ScanBatchItem[]): number {
  return items.filter(i => i.type === 'damaged' && !i.admin_decision).length
}
