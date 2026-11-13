import { tierForPlugin, estimateCalls, LOOKUP_CALLS_PER_BOOK } from '../../src/services/cost-estimator';

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
    expect(estimateCalls({ ai_fill: true, books_to_fill: 7, lookup: false })).toEqual({ fill: 7, total: 7 });
  });
  it('zero when ai_fill off', () => {
    expect(estimateCalls({ ai_fill: false, books_to_fill: 7, lookup: true })).toEqual({ fill: 0, total: 0 });
  });
});

describe('estimateCalls (lookup)', () => {
  it('multiplies by (1 + LOOKUP_CALLS_PER_BOOK) when lookup on', () => {
    expect(LOOKUP_CALLS_PER_BOOK).toBe(6);
    expect(estimateCalls({ ai_fill: true, books_to_fill: 10, lookup: true }).fill).toBe(70);
  });
  it('one call per book when lookup off', () => {
    expect(estimateCalls({ ai_fill: true, books_to_fill: 10, lookup: false }).fill).toBe(10);
  });
});
