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

  it('groups same-author books with low title edit distance', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '斗破苍穹', author: '天蚕土豆', fingerprint: fp('a') },
      { file_path: '/b', title: '斗破苍穹（修订版）', author: '天蚕土豆', fingerprint: fp('b') },
      { file_path: '/c', title: '完全不同的书', author: '别人', fingerprint: fp('c') },
    ];
    const r = buildCandidateGroups(books);
    expect(r.soft_groups).toHaveLength(1);
    expect(r.soft_groups[0]).toHaveLength(2);
    expect(r.soft_groups[0].map(b => b.file_path).sort()).toEqual(['/a', '/b']);
  });

  it('groups books with same chapter_count + same first_chapter_hash', () => {
    const books: ScannedBook[] = [
      { file_path: '/a', title: '三体 v1', fingerprint: fp('fa'), chapter_count: 50, first_chapter_hash: 'H1' },
      { file_path: '/b', title: '三体 v2', fingerprint: fp('fb'), chapter_count: 50, first_chapter_hash: 'H1' },
      { file_path: '/c', title: '别的书', fingerprint: fp('fc'), chapter_count: 30, first_chapter_hash: 'H2' },
    ];
    const r = buildCandidateGroups(books);
    expect(r.soft_groups).toHaveLength(1);
    expect(r.soft_groups[0].map(b => b.file_path).sort()).toEqual(['/a', '/b']);
  });

  it('merges overlapping soft sources into one cluster', () => {
    // Book /a appears in both norm-group and author-cluster → should end up
    // in a single merged soft group with all 3 books.
    const books: ScannedBook[] = [
      { file_path: '/a', title: '斗破苍穹', author: '天蚕土豆', fingerprint: fp('a') },
      { file_path: '/b', title: '斗破苍穹', author: '别人', fingerprint: fp('b') },     // norm-equal with /a
      { file_path: '/c', title: '斗破苍穹（番外）', author: '天蚕土豆', fingerprint: fp('c') }, // author+distance with /a
    ];
    const r = buildCandidateGroups(books);
    expect(r.soft_groups).toHaveLength(1);
    expect(r.soft_groups[0]).toHaveLength(3);
  });
});

describe('buildCandidateGroups.title_author_groups', () => {
  const mk = (file_path: string, title: string, author: string, fingerprint: string) =>
    ({ file_path, title, author, fingerprint, chapter_count: 10, first_chapter_hash: fingerprint, first_chapter_preview: '' });

  it('同书名同作者、指纹不同 → 成一组', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '《黄金瞳(典当)》（精校版全本）作者：打眼', '打眼', 'fpA'),
      mk('/b.txt', '《黄金瞳(典当)》（校对版全本）作者：打眼', '打眼', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(1);
    expect(r.title_author_groups[0].map(x => x.file_path).sort()).toEqual(['/a.txt', '/b.txt']);
  });

  it('同书名不同作者 → 不成组', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'fpA'),
      mk('/b.txt', '黄金瞳', '别人', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('指纹相同 → 归 hard，不计入 title_author_groups', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'same'),
      mk('/b.txt', '黄金瞳', '打眼', 'same'),
    ]);
    expect(r.hard_groups.length).toBe(1);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('author 为空 → 跳过', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '', 'fpA'),
      mk('/b.txt', '黄金瞳', '', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });
});
