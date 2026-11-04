import { parseAiFillApplyBody } from '../../src/services/ai-fill-apply';

const base = {
  recommended_tags: ['历史'],
  similar_works: [{ title: '水浒传' }],
  cover: { type: 'keep' },
  suggested: {},
};

describe('parseAiFillApplyBody', () => {
  it('accepts a long imported summary (well beyond 5000 chars)', () => {
    const r = parseAiFillApplyBody({ ...base, summary: '字'.repeat(12000) });
    expect(r.ok).toBe(true);
  });

  it('names the offending field when a value is too long', () => {
    const r = parseAiFillApplyBody({ ...base, summary: '字'.repeat(20001) });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('简介') });
  });

  it('names the similar-works field for an over-long reason', () => {
    const r = parseAiFillApplyBody({ ...base, similar_works: [{ title: 'a', reason: '因'.repeat(501) }] });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('类似作品') });
  });

  it('accepts an AI similar-works reason of a few hundred chars', () => {
    expect(parseAiFillApplyBody({ ...base, similar_works: [{ title: 'a', reason: '因'.repeat(400) }] }).ok).toBe(true);
  });

  it('names the tags field for too many tags', () => {
    const r = parseAiFillApplyBody({ ...base, recommended_tags: Array.from({ length: 21 }, (_, i) => `t${i}`) });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('推荐标签') });
  });

  it('rejects an unknown cover type', () => {
    const r = parseAiFillApplyBody({ ...base, cover: { type: 'url', pic: 'x' } });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('封面') });
  });

  it('trims string fields', () => {
    const r = parseAiFillApplyBody({ ...base, author: '  罗贯中 ' });
    expect(r.ok && r.data.author).toBe('罗贯中');
  });
});
