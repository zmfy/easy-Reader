import { coverStyleForCategory, renderDefaultCoverSvg } from '../../src/utils/default-cover';

describe('coverStyleForCategory', () => {
  it.each([
    ['玄幻', 'night'],
    ['古代言情', 'night'],   // 网文关键词优先于「古代」
    ['古典小说', 'classic'],
    ['古典文学', 'classic'],
    ['历史', 'modern'],
    ['综合', 'modern'],
    ['', 'modern'],
  ])('%s → %s', (category, style) => {
    expect(coverStyleForCategory(category)).toBe(style);
  });

  it('treats null / undefined as modern', () => {
    expect(coverStyleForCategory(null)).toBe('modern');
    expect(coverStyleForCategory(undefined)).toBe('modern');
  });
});

describe('renderDefaultCoverSvg', () => {
  it('produces a standalone svg document', () => {
    const svg = renderDefaultCoverSvg({ title: '三国演义', author: '罗贯中', category: '历史' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it.each(['玄幻', '古典小说', '历史'])('escapes markup in the title (%s style)', (category) => {
    // 短书名，确保 < > & " 都在截断长度内、真正被输出
    const svg = renderDefaultCoverSvg({ title: '<i>&"', author: 'a<b', category });
    expect(svg).not.toContain('<i>');
    expect(svg).toContain('&lt;');
    expect(svg).toContain('&amp;');
    expect(svg).not.toContain('a<b');
  });

  it('omits the 著 suffix when there is no author', () => {
    for (const category of ['玄幻', '古典小说', '历史']) {
      expect(renderDefaultCoverSvg({ title: '无名书', category })).not.toContain('著');
      expect(renderDefaultCoverSvg({ title: '无名书', author: '  ', category })).not.toContain('著');
    }
  });

  it('prints the author (vertical styles draw one glyph per text element)', () => {
    const svg = renderDefaultCoverSvg({ title: '诛仙', author: '罗贯中', category: '玄幻' });
    expect(svg).toContain('>罗<');
    expect(svg).toContain('著');
  });

  it.each(['玄幻', '古典小说', '历史'])('truncates very long titles with … (%s style)', (category) => {
    const svg = renderDefaultCoverSvg({ title: '天'.repeat(30), author: '某某', category });
    expect(svg).toContain('…');
    expect((svg.match(/<text/g) || []).length).toBeLessThanOrEqual(40);
  });

  it('handles emoji / surrogate pairs without splitting them', () => {
    const svg = renderDefaultCoverSvg({ title: '😀书名', category: '玄幻' });
    expect(svg).toContain('>😀<');
  });

  it('is deterministic and varies the modern gradient by title', () => {
    const a = renderDefaultCoverSvg({ title: '三国演义', category: '历史' });
    expect(renderDefaultCoverSvg({ title: '三国演义', category: '历史' })).toBe(a);
    const b = renderDefaultCoverSvg({ title: '红楼梦', category: '历史' });
    const colors = (s: string) => (s.match(/stop-color="[^"]+"/g) || []).join();
    expect(colors(a)).not.toBe(colors(b));
  });

  it('references no external resources or scripts', () => {
    for (const category of ['玄幻', '古典小说', '历史']) {
      const svg = renderDefaultCoverSvg({ title: '三国演义', author: '罗贯中', category });
      expect(svg).not.toMatch(/<script|href=|url\(http|on\w+=/i);
    }
  });
});
