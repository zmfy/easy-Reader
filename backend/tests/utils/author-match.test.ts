import { authorsMatch, normalizeAuthor } from '../../src/utils/author-match';

describe('normalizeAuthor', () => {
  it('去空白/全角空格、去尾部「著」、小写', () => {
    expect(normalizeAuthor(' 南派三叔 著 ')).toBe('南派三叔');
    expect(normalizeAuthor('Ａｂｃ')).toBe('abc');
  });
});

describe('authorsMatch', () => {
  it('归一化后完全相等', () => {
    expect(authorsMatch('打眼', '打眼')).toBe(true);
    expect(authorsMatch('南派三叔 著', '南派三叔')).toBe(true);
  });
  it('包含关系算一致', () => {
    expect(authorsMatch('天蚕土豆', '天蚕土豆(唐家三少推荐)')).toBe(true);
  });
  it('2/3 以上文字一致（模糊）算一致', () => {
    expect(authorsMatch('夜的七宗罪', '夜的七宗')).toBe(true); // 距离1/长度5 → 0.8
  });
  it('差异过大不一致', () => {
    expect(authorsMatch('打眼', '唐家三少')).toBe(false);
  });
  it('任一方为空不一致', () => {
    expect(authorsMatch('', '打眼')).toBe(false);
    expect(authorsMatch('打眼', '')).toBe(false);
  });
  it('过短的包含不算一致（避免误判）', () => {
    expect(authorsMatch('A', 'ABCDEFG')).toBe(false);
  });
});
