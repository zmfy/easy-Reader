import { tierForPlugin, estimateCalls } from '../../src/services/cost-estimator';

describe('tierForPlugin', () => {
  it('classifies free providers', () => {
    expect(tierForPlugin('ollama')).toBe('free');
  });
  it('classifies low-cost providers', () => {
    expect(tierForPlugin('deepseek')).toBe('low');
    expect(tierForPlugin('qwen')).toBe('low');
    expect(tierForPlugin('minmax')).toBe('low');
  });
  it('classifies high-cost providers', () => {
    expect(tierForPlugin('openai')).toBe('high');
    expect(tierForPlugin('claude')).toBe('high');
  });
  it('returns unknown for unrecognized plugin', () => {
    expect(tierForPlugin('whatever')).toBe('unknown');
  });
});

describe('estimateCalls (fill-only)', () => {
  it('counts fill candidates when ai_fill on', () => {
    expect(estimateCalls({ ai_fill: true, books_to_fill: 7 })).toEqual({ fill: 7, total: 7 });
  });
  it('zero when ai_fill off', () => {
    expect(estimateCalls({ ai_fill: false, books_to_fill: 7 })).toEqual({ fill: 0, total: 0 });
  });
});
