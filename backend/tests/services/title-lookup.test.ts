import { matchTitlesToBooks, LibraryBookForLookup } from '../../src/services/title-lookup';

const lib: LibraryBookForLookup[] = [
  { id: 'b1', title: '盗墓笔记1', author: '南派三叔', chapter_count: 50 },
  { id: 'b2', title: '盗墓笔记 第二部', author: '南派三叔', chapter_count: 40 },
  { id: 'b3', title: '三体', author: '刘慈欣', chapter_count: 30 },
];

describe('matchTitlesToBooks', () => {
  it('links a base title to an in-library volume via normalization', () => {
    // AI returns the series base "盗墓笔记"; library only has numbered volumes.
    const r = matchTitlesToBooks([{ title: '盗墓笔记' }], lib);
    expect(r[0].book_id).not.toBeNull();
    expect(['b1', 'b2']).toContain(r[0].book_id);
  });

  it('still matches an exact title', () => {
    const r = matchTitlesToBooks([{ title: '三体', author: '刘慈欣' }], lib);
    expect(r[0].book_id).toBe('b3');
  });

  it('returns null when no library book matches', () => {
    const r = matchTitlesToBooks([{ title: '不存在的书' }], lib);
    expect(r[0].book_id).toBeNull();
  });

  it('returns null for a title that normalizes to empty', () => {
    const r = matchTitlesToBooks([{ title: '上' }], lib);
    expect(r[0].book_id).toBeNull();
  });

  it('prefers a same-author match over an exact-but-different-author match', () => {
    const lib2: LibraryBookForLookup[] = [
      { id: 'x', title: '重生', author: '作者A', chapter_count: 10 },
      { id: 'y', title: '重生1', author: '作者B', chapter_count: 10 },
    ];
    const r = matchTitlesToBooks([{ title: '重生', author: '作者B' }], lib2);
    expect(r[0].book_id).toBe('y');
  });

  it('prefers an exact title (library author unknown) over an author-match sibling volume', () => {
    // Real bug: on 女生寝室1, the AI suggested "女生寝室2" but guessed its author
    // as 沈醉天 (copied from vol.1). lookupKey collapses 女生寝室1/2 to one key.
    // The library's 女生寝室2 has no author, so the guessed author falsely matched
    // 女生寝室1 (the current book) over the exact-title 女生寝室2.
    const series: LibraryBookForLookup[] = [
      { id: 'v1', title: '女生寝室1', author: '沈醉天', chapter_count: 100 },
      { id: 'v2', title: '女生寝室2', author: null, chapter_count: 90 },
    ];
    const r = matchTitlesToBooks([{ title: '女生寝室2', author: '沈醉天' }], series);
    expect(r[0].book_id).toBe('v2');
  });

  it('prefers an exact title over a normalized volume match when no author given', () => {
    const lib3: LibraryBookForLookup[] = [
      { id: 'p', title: '盗墓笔记', author: '南派三叔', chapter_count: 5 },
      { id: 'q', title: '盗墓笔记2', author: '南派三叔', chapter_count: 60 },
    ];
    const r = matchTitlesToBooks([{ title: '盗墓笔记' }], lib3);
    expect(r[0].book_id).toBe('p');
  });

  it('preserves the query title/author in the result', () => {
    const r = matchTitlesToBooks([{ title: '盗墓笔记', author: '南派三叔' }], lib);
    expect(r[0].title).toBe('盗墓笔记');
    expect(r[0].author).toBe('南派三叔');
  });

  it('matches a title polluted with brackets and 作者 suffix', () => {
    // Real library titles bake decorations + author into the title field.
    const dirty: LibraryBookForLookup[] = [
      { id: 'd1', title: '《盗墓笔记》作者：南派三叔', author: '南派三叔', chapter_count: 80 },
      { id: 'd2', title: '《盗墓笔记》（实体封面全本）作者：南派三叔', author: '南派三叔', chapter_count: 75 },
    ];
    const r = matchTitlesToBooks([{ title: '盗墓笔记', author: '南派三叔' }], dirty);
    expect(['d1', 'd2']).toContain(r[0].book_id);
  });

  it('matches a title wrapped in 《》 with a （…全本） annotation', () => {
    const dirty: LibraryBookForLookup[] = [
      { id: 'g1', title: '《女生理工宿舍》（实体版全本）作者：异度社', author: '异度社', chapter_count: 20 },
    ];
    const r = matchTitlesToBooks([{ title: '女生理工宿舍' }], dirty);
    expect(r[0].book_id).toBe('g1');
  });

  it('uses author to disambiguate a different-author same-base spinoff', () => {
    const dirty: LibraryBookForLookup[] = [
      { id: 'main', title: '《盗墓笔记》作者：南派三叔', author: '南派三叔', chapter_count: 80 },
      { id: 'spin', title: '《盗墓笔记续9》（校对版全本）作者：邪灵一把刀', author: '邪灵一把刀', chapter_count: 30 },
    ];
    const r = matchTitlesToBooks([{ title: '盗墓笔记', author: '南派三叔' }], dirty);
    expect(r[0].book_id).toBe('main');
  });
});
