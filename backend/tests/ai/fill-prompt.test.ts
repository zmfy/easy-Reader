import { buildFillPrompt, fieldConfidence } from '../../src/ai/fill-prompt';

describe('buildFillPrompt', () => {
  it('embeds evidence and library categories without assuming web novels', () => {
    const p = buildFillPrompt('【文件名】克莱因文集.epub', { summary_length: '150', categories: '历史,外国文学' });
    expect(p).toContain('【文件名】克莱因文集.epub');
    expect(p).toContain('历史、外国文学');
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
