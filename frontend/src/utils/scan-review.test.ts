import { describe, it, expect } from 'vitest'
import { undecidedDamagedCount, organizeDecisionOf } from './scan-review'
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

describe('organizeDecisionOf', () => {
  it('未选择默认保留整理版、隐藏原书；拒绝 = 保留原书；有 admin_payload 以它为准', () => {
    expect(organizeDecisionOf({ admin_decision: null, admin_payload: null })).toBe('keep_new_hide_old')
    expect(organizeDecisionOf({ admin_decision: 'reject', admin_payload: null })).toBe('keep_old')
    expect(organizeDecisionOf({ admin_decision: 'accept', admin_payload: '{"decision":"keep_new_delete_file"}' })).toBe('keep_new_delete_file')
    expect(organizeDecisionOf({ admin_decision: 'accept', admin_payload: '{"decision":"bogus"}' })).toBe('keep_new_hide_old')
    expect(organizeDecisionOf({ admin_decision: 'accept', admin_payload: '{bad' })).toBe('keep_new_hide_old')
  })
})
