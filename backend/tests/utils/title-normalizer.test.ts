import { normalizeTitle, levenshtein, extractAuthorFromName } from '../../src/utils/title-normalizer';

describe('normalizeTitle', () => {
  it('strips parenthesized suffixes', () => {
    expect(normalizeTitle('斗破苍穹（上）')).toBe('斗破苍穹');
    expect(normalizeTitle('斗破苍穹(下)')).toBe('斗破苍穹');
  });
  it('strips trailing digit suffixes', () => {
    expect(normalizeTitle('女生宿舍1')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 2')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 第3部')).toBe('女生宿舍');
  });
  it('strips above/middle/below markers', () => {
    expect(normalizeTitle('三体 上')).toBe('三体');
    expect(normalizeTitle('三体下')).toBe('三体');
    expect(normalizeTitle('遮天 续')).toBe('遮天');
  });
  it('handles full-width and half-width digits/spaces', () => {
    expect(normalizeTitle('女生宿舍１')).toBe('女生宿舍');
    expect(normalizeTitle('女生宿舍 １')).toBe('女生宿舍');
  });
  it('preserves clean titles', () => {
    expect(normalizeTitle('三体')).toBe('三体');
    expect(normalizeTitle('诛仙')).toBe('诛仙');
  });
});

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });
  it('returns 1 for single edit', () => {
    expect(levenshtein('女生宿舍1', '女生宿舍2')).toBe(1);
    expect(levenshtein('catch', 'match')).toBe(1);
  });
  it('returns length for empty vs string', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });
});

describe('extractAuthorFromName', () => {
  it('提取「作者：X」', () => {
    expect(extractAuthorFromName('《黄金瞳(典当)》（精校版全本）作者：打眼.txt')).toBe('打眼');
  });
  it('提取「作者:X」半角冒号', () => {
    expect(extractAuthorFromName('18《轻狂》作者:巫哲')).toBe('巫哲');
  });
  it('无作者段返回 null', () => {
    expect(extractAuthorFromName('绿林七宗罪大史记.txt')).toBeNull();
  });
  it('去掉首尾空白', () => {
    expect(extractAuthorFromName('某书 作者： 夜的七宗罪 ')).toBe('夜的七宗罪');
  });
});
