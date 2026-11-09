import { buildFillPrompt, fieldConfidence, detectContentMismatch } from '../../src/ai/fill-prompt';

describe('buildFillPrompt', () => {
  it('embeds evidence and library categories without assuming web novels', () => {
    const p = buildFillPrompt('【文件名】克莱因文集.epub', { summary_length: '150', categories: '小说/外国小说,社科/心理学' });
    expect(p).toContain('【文件名】克莱因文集.epub');
    expect(p).toContain('小说/外国小说\n社科/心理学');
    expect(p).toContain('150字左右');
    expect(p).toContain('"confidence"');
    expect(p).not.toContain('熟悉中文网络小说');
    expect(p).not.toContain('不要从下方文本中分析');
  });

  it('includes known title / author hints', () => {
    const p = buildFillPrompt('x', {}, { title: '鉴宝', author: '打眼' });
    expect(p).toContain('书名：《鉴宝》，作者：打眼');
  });
});

describe('fieldConfidence', () => {
  it('reads confidence per field, defaulting to medium', () => {
    const info = { confidence: { author: 'high', summary: 'low', category: 'weird' } };
    expect(fieldConfidence(info, 'author')).toBe('high');
    expect(fieldConfidence(info, 'summary')).toBe('low');
    expect(fieldConfidence(info, 'category')).toBe('medium');
    expect(fieldConfidence({}, 'author')).toBe('medium');
  });
});

describe('content mismatch', () => {
  it('asks the model whether the content matches the file name', () => {
    expect(buildFillPrompt('x', {})).toContain('filename_matches');
  });

  it('only flags an explicit, not-low-confidence mismatch', () => {
    const info = { title: '诡秘之主', author: '爱潜水的乌贼', filename_matches: false, mismatch_reason: '正文是另一部', confidence: { title: 'high' } };
    expect(detectContentMismatch(info)).toEqual({ title: '诡秘之主', author: '爱潜水的乌贼', reason: '正文是另一部' });
    expect(detectContentMismatch({ ...info, filename_matches: true })).toBeUndefined();
    expect(detectContentMismatch({ ...info, filename_matches: undefined })).toBeUndefined();
    expect(detectContentMismatch({ ...info, confidence: { title: 'low' } })).toBeUndefined();
    expect(detectContentMismatch({ ...info, title: '' })).toBeUndefined();
    // 模型在 title 里沿用了文件名：以 content_title / content_author 为准
    expect(detectContentMismatch({ ...info, title: '三国演义', author: undefined, content_title: '诡秘之主', content_author: '爱潜水的乌贼' }))
      .toMatchObject({ title: '诡秘之主', author: '爱潜水的乌贼' });
  });
});
