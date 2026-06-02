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

describe('estimateCalls', () => {
  it('returns zero counts when all flags disabled', () => {
    const r = estimateCalls({
      ai_dedup: false, ai_series: false, ai_fill: false,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 0, series: 0, fill: 0, total: 0 });
  });

  it('sums enabled flag counts', () => {
    const r = estimateCalls({
      ai_dedup: true, ai_series: true, ai_fill: true,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 5, series: 3, fill: 100, total: 108 });
  });

  it('respects disable mix', () => {
    const r = estimateCalls({
      ai_dedup: true, ai_series: false, ai_fill: true,
      soft_dup_candidate_groups: 5, series_fuzzy_groups: 3, books_to_fill: 100,
    });
    expect(r).toEqual({ dedup: 5, series: 0, fill: 100, total: 105 });
  });
});
