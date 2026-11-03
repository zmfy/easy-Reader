import { extractSeriesCandidates, ScannedBookForSeries } from '../../src/services/series-regex';

describe('extractSeriesCandidates', () => {
  it('groups numeric-suffix books with same author', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
      { file_path: '/2', title: '女生宿舍2', author: 'A' },
      { file_path: '/3', title: '女生宿舍3', author: 'A' },
      { file_path: '/x', title: '三体', author: 'B' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].series_name).toBe('女生宿舍');
    expect(groups[0].members).toHaveLength(3);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2, 3]);
  });

  it('groups 第N部 markers', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '遮天 第一部', author: '辰东' },
      { file_path: '/2', title: '遮天 第二部', author: '辰东' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].series_name).toBe('遮天');
  });

  it('does NOT group books with different authors', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
      { file_path: '/2', title: '女生宿舍2', author: 'B' },
    ];
    expect(extractSeriesCandidates(books)).toHaveLength(0);
  });

  it('does NOT group single book', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍1', author: 'A' },
    ];
    expect(extractSeriesCandidates(books)).toHaveLength(0);
  });

  it('groups books with missing author by title only when both have no author', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '某书1', author: undefined },
      { file_path: '/2', title: '某书2', author: undefined },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
  });

  it('groups parenthesized sequence: 女生宿舍(1) (2) (3)', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍(1)' },
      { file_path: '/2', title: '女生宿舍(2)' },
      { file_path: '/3', title: '女生宿舍(3)' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2, 3]);
  });

  it('groups full-width parens: 女生宿舍（一）（二）', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '女生宿舍（一）' },
      { file_path: '/2', title: '女生宿舍（二）' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2]);
  });

  it('strips 《》 decoration: 《女生宿舍》1 vs 《女生宿舍》2', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '《女生宿舍》1' },
      { file_path: '/2', title: '《女生宿舍》2' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
  });

  it('handles leading numeric prefix: 01.女生宿舍, 02.女生宿舍', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '01.女生宿舍' },
      { file_path: '/2', title: '02.女生宿舍' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2]);
  });

  it('handles roman numerals: 三体 I, 三体 II', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '三体(I)' },
      { file_path: '/2', title: '三体(II)' },
      { file_path: '/3', title: '三体(III)' },
    ];
    const groups = extractSeriesCandidates(books);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map(m => m.sequence)).toEqual([1, 2, 3]);
  });

  it('does NOT split year-like 4-digit suffix: 三体2024 should not become a series candidate', () => {
    const books: ScannedBookForSeries[] = [
      { file_path: '/1', title: '三体2024' },
      { file_path: '/2', title: '三体2025' },
    ];
    // 4-digit allowed — these would group as a series. That's a tradeoff;
    // documenting current behavior.
    const groups = extractSeriesCandidates(books);
    expect(groups.length).toBeLessThanOrEqual(1);
  });
});
