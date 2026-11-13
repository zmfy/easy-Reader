import { describe, it, expect } from 'vitest'
import { buildAiSettingsPayload, parseLookupEnabled } from './ai-settings'

describe('buildAiSettingsPayload', () => {
  const fields = ['apiKey', 'model', 'reasoningEffort']

  it('submits an emptied free-text field so the stored value is cleared', () => {
    const p = buildAiSettingsPayload('minmax', fields, { apiKey: 'sk-1', model: '', reasoningEffort: '' }, 100, 3, true)
    expect(p['ai_minmax_model']).toBe('')
    expect(p['ai_minmax_reasoningEffort']).toBe('')
  })

  it('submits fields missing from the form as empty', () => {
    const p = buildAiSettingsPayload('minmax', fields, {}, 100, 3, true)
    expect(p['ai_minmax_model']).toBe('')
  })

  it('omits apiKey when empty (= keep the saved key)', () => {
    const p = buildAiSettingsPayload('minmax', fields, { model: 'MiniMax-M3' }, 100, 3, true)
    expect(p).not.toHaveProperty('ai_minmax_apiKey')
    expect(p['ai_minmax_model']).toBe('MiniMax-M3')
  })

  it('submits apiKey when filled, plus plugin, summary length and concurrency', () => {
    const p = buildAiSettingsPayload('minmax', fields, { apiKey: 'sk-2' }, 150, 4, true)
    expect(p).toMatchObject({
      ai_plugin: 'minmax',
      ai_summary_length: '150',
      ai_fill_concurrency: '4',
      ai_minmax_apiKey: 'sk-2',
    })
  })
})

describe('parseLookupEnabled', () => {
  it('defaults to on when unset or any other value', () => {
    expect(parseLookupEnabled(undefined)).toBe(true)
    expect(parseLookupEnabled('1')).toBe(true)
    expect(parseLookupEnabled('')).toBe(true)
  })
  it("is off only for '0'", () => {
    expect(parseLookupEnabled('0')).toBe(false)
  })
})

describe('buildAiSettingsPayload lookup switch', () => {
  it("saves ai_lookup_enabled as '1' / '0'", () => {
    expect(buildAiSettingsPayload('minmax', [], {}, 100, 3, true)['ai_lookup_enabled']).toBe('1')
    expect(buildAiSettingsPayload('minmax', [], {}, 100, 3, false)['ai_lookup_enabled']).toBe('0')
  })
})
