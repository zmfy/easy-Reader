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

  it('同书名不同格式、都没有作者 → 成一组', () => {
    const r = buildCandidateGroups([
      mk('/books/易中天品三国.epub', '易中天品三国', '', 'fpA'),
      mk('/books/易中天品三国.txt', '易中天品三国', '', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(1);
    expect(r.title_author_groups[0].map(x => x.file_path).sort()).toEqual(['/books/易中天品三国.epub', '/books/易中天品三国.txt']);
  });

  it('一本有作者、一本没有，书名号 / 作者后缀不同 → 成一组', () => {
    const r = buildCandidateGroups([
      mk('/a.epub', '易中天品三国', '', 'fpA'),
      mk('/b.txt', '《易中天品三国》作者：易中天', '易中天', 'fpB'),
    ]);
    expect(r.title_author_groups.length).toBe(1);
  });

  it('作者为空时不去卷号：分卷不算重复', () => {
    const r = buildCandidateGroups([
      mk('/1.txt', '斗罗大陆1', '', 'fpA'),
      mk('/2.txt', '斗罗大陆2', '', 'fpB'),
      mk('/s.txt', '明朝那些事儿（上）', '', 'fpC'),
      mk('/x.txt', '明朝那些事儿（下）', '', 'fpD'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('同书名出现两个不同作者 → 空作者的不归入任何一组', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'fpA'),
      mk('/b.txt', '黄金瞳', '别人', 'fpB'),
      mk('/c.epub', '黄金瞳', '', 'fpC'),
    ]);
    expect(r.title_author_groups.length).toBe(0);
  });

  it('两条规则命中同一批书 → 合并成一组，不重复出现', () => {
    const r = buildCandidateGroups([
      mk('/a.txt', '黄金瞳', '打眼', 'fpA'),
      mk('/b.txt', '黄金瞳', '打眼', 'fpB'),
      mk('/c.epub', '黄金瞳', '', 'fpC'),
    ]);
    expect(r.title_author_groups.length).toBe(1);
    expect(r.title_author_groups[0].map(x => x.file_path).sort()).toEqual(['/a.txt', '/b.txt', '/c.epub']);
  });
});

import { applyNotDuplicateOverrides, mergeDuplicateGroups } from '../../src/services/dedup-grouper';

describe('硬重复 + 书名软重复合并', () => {
  const b = (file_path: string, title: string, fingerprint: string): ScannedBook =>
    ({ file_path, title, author: '', fingerprint, chapter_count: 10 });

  it('epub 与硬重复组里的同名 umd 配对，三本合成一组', () => {
    const books = [
      b('/西游记.umd', '西游记', 'same'),
      b('/易中天品三国.umd', '易中天品三国', 'same'),
      b('/易中天品三国.epub', '易中天品三国', 'other'),
    ];
    const r = buildCandidateGroups(books);
    expect(r.hard_groups.length).toBe(1);
    expect(r.title_author_groups.length).toBe(1);
    const merged = mergeDuplicateGroups(r.hard_groups, r.title_author_groups);
    expect(merged.length).toBe(1);
    expect(merged[0].books.map(x => x.file_path).sort()).toEqual(['/易中天品三国.epub', '/易中天品三国.umd', '/西游记.umd']);
    expect([...merged[0].hardPaths].sort()).toEqual(['/易中天品三国.umd', '/西游记.umd']);
  });

  it('没有交集的组保持独立', () => {
    const merged = mergeDuplicateGroups(
      [[b('/a', 'A', 'x'), b('/a2', 'A复制', 'x')]],
      [[b('/c.epub', 'C', 'y'), b('/c.txt', 'C', 'z')]],
    );
    expect(merged.length).toBe(2);
    expect(merged[1].hardPaths.size).toBe(0);
  });
});

describe('applyNotDuplicateOverrides', () => {
  const b = (p: string) => ({ file_path: p, title: p, first_chapter_preview: '' });
  const idByPath = new Map([['/a', 'A'], ['/b', 'B'], ['/c', 'C']]);
  const pairs = (...ps: Array<[string, string]>) => new Set(ps.flatMap(([x, y]) => [`${x}|${y}`, `${y}|${x}`]));

  it('drops a group whose members were all declared not-duplicate', () => {
    const groups = [[b('/a'), b('/b'), b('/c')]];
    expect(applyNotDuplicateOverrides(groups, idByPath, pairs(['A', 'B'], ['A', 'C'], ['B', 'C']))).toEqual([]);
  });

  it('removes only the member declared not-duplicate with everyone else', () => {
    const groups = [[b('/a'), b('/b'), b('/c')]];
    const out = applyNotDuplicateOverrides(groups, idByPath, pairs(['C', 'A'], ['C', 'B']));
    expect(out.map(g => g.map(m => m.file_path))).toEqual([['/a', '/b']]);
  });

  it('keeps new files (no book id yet) and groups without overrides', () => {
    const groups = [[b('/a'), b('/new.txt')], [b('/b'), b('/c')]];
    const out = applyNotDuplicateOverrides(groups, idByPath, pairs(['A', 'B']));
    expect(out.map(g => g.map(m => m.file_path))).toEqual([['/a', '/new.txt'], ['/b', '/c']]);
  });
});
