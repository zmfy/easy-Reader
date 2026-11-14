import { describe, it, expect } from 'vitest'
import { undecidedDamagedCount } from './scan-review'
import type { ScanBatchItem } from '@/types'

function item(type: ScanBatchItem['type'], decision: ScanBatchItem['admin_decision'] = null): ScanBatchItem {
  return { id: Math.random().toString(36), batch_id: 'b', type, payload: '{}', admin_decision: decision }
}

describe('undecidedDamagedCount', () => {
  it('counts only damaged items without a decision', () => {
    const items = [
      item('damaged'),
      item('damaged', undefined),
      item('damaged', 'accept'),
      item('damaged', 'reject'),
      item('new'),
      item('garbled'),
      item('duplicate_group'),
    ]
    expect(undecidedDamagedCount(items)).toBe(2)
  })

  it('returns 0 for an empty list', () => {
    expect(undecidedDamagedCount([])).toBe(0)
  })
})
