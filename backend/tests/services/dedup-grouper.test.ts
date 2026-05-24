import { buildCandidateGroups, ScannedBook } from '../../src/services/dedup-grouper';

const fp = (s: string) => 'fingerprint_' + s;

describe('buildCandidateGroups', () => {
  it('returns empty groups for unique books', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '三体', author: '刘慈欣', fingerprint: fp('a') },
      { file_path: '/b', title: '诛仙', author: '萧鼎', fingerprint: fp('b') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toEqual([]);
    expect(r.soft_groups).toEqual([]);
  });

  it('groups books with identical fingerprint as hard duplicates', () => {
    const books: ScannedBook[] = [
      { file_path: '/a1', title: '三体', author: '刘慈欣', fingerprint: fp('x') },
      { file_path: '/a2', title: '三体复制', author: '刘慈欣', fingerprint: fp('x') },
      { file_path: '/b', title: '诛仙', author: '萧鼎', fingerprint: fp('y') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toHaveLength(1);
    expect(r.hard_groups[0].length).toBe(2);
    expect(r.soft_groups).toEqual([]);
  });

  it('groups books with normalized title as soft candidates', () => {
    const books: ScannedBook[] = [
      { file_path: '/1', title: '女生宿舍1', author: '同作者', fingerprint: fp('1') },
      { file_path: '/2', title: '女生宿舍2', author: '同作者', fingerprint: fp('2') },
      { file_path: '/c', title: '三体', author: '刘慈欣', fingerprint: fp('c') },
    ];
    const r = buildCandidateGroups(books);
    // soft group should contain the two 女生宿舍
    expect(r.soft_groups).toHaveLength(1);
    expect(r.soft_groups[0]).toHaveLength(2);
  });

  it('does NOT put books in soft group if they are already in hard group', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '女生宿舍1', fingerprint: fp('x') },
      { file_path: '/b', title: '女生宿舍1', fingerprint: fp('x') }, // hard dup
      { file_path: '/c', title: '女生宿舍2', fingerprint: fp('y') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toHaveLength(1);
    // soft groups should not duplicate-include /a or /b
    const softPaths = r.soft_groups.flat().map(b => b.file_path);
    expect(softPaths).not.toContain('/a');
    expect(softPaths).not.toContain('/b');
  });

  it('skips books without fingerprint', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '三体', fingerprint: undefined },
      { file_path: '/b', title: '三体', fingerprint: undefined },
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups).toEqual([]);
    expect(r.soft_groups).toEqual([]);
  });
});
