import { describe, it, expect, vi } from 'vitest'
import { pollUntil } from './poll'

describe('pollUntil', () => {
  it('returns the first truthy probe result', async () => {
    let n = 0
    expect(await pollUntil(() => (++n >= 3 ? 'ok' : null), { tries: 5, interval: 1 })).toBe('ok')
    expect(n).toBe(3)
  })

  it('gives up after the given number of tries', async () => {
    const probe = vi.fn(() => null)
    expect(await pollUntil(probe, { tries: 4, interval: 1 })).toBeNull()
    expect(probe).toHaveBeenCalledTimes(4)
  })

  it('does not spend tries while hold() is true (e.g. PDF still downloading)', async () => {
    let held = 10
    const probe = vi.fn(() => null)
    await pollUntil(probe, { tries: 2, interval: 1, hold: () => held-- > 0 })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(held).toBeLessThan(0)
  })

  it('supports async probes', async () => {
    expect(await pollUntil(async () => 7, { tries: 1, interval: 1 })).toBe(7)
  })
})
