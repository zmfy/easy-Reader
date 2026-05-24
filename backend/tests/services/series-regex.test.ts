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
});
