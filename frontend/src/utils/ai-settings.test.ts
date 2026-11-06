import { describe, it, expect } from 'vitest'
import { buildAiSettingsPayload } from './ai-settings'

describe('buildAiSettingsPayload', () => {
  const fields = ['apiKey', 'model', 'reasoningEffort']

  it('submits an emptied free-text field so the stored value is cleared', () => {
    const p = buildAiSettingsPayload('minmax', fields, { apiKey: 'sk-1', model: '', reasoningEffort: '' }, 100, 3)
    expect(p['ai_minmax_model']).toBe('')
    expect(p['ai_minmax_reasoningEffort']).toBe('')
  })

  it('submits fields missing from the form as empty', () => {
    const p = buildAiSettingsPayload('minmax', fields, {}, 100, 3)
    expect(p['ai_minmax_model']).toBe('')
  })

  it('omits apiKey when empty (= keep the saved key)', () => {
    const p = buildAiSettingsPayload('minmax', fields, { model: 'MiniMax-M3' }, 100, 3)
    expect(p).not.toHaveProperty('ai_minmax_apiKey')
    expect(p['ai_minmax_model']).toBe('MiniMax-M3')
  })

  it('submits apiKey when filled, plus plugin, summary length and concurrency', () => {
    const p = buildAiSettingsPayload('minmax', fields, { apiKey: 'sk-2' }, 150, 4)
    expect(p).toMatchObject({
      ai_plugin: 'minmax',
      ai_summary_length: '150',
      ai_fill_concurrency: '4',
      ai_minmax_apiKey: 'sk-2',
    })
  })
})
