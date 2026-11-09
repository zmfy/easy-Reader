import Database from 'better-sqlite3';
import {
  DEFAULT_CATEGORY_TREE, validateCategoryTree, categoryPaths, isValidCategoryPath, resolveCategoryPath,
  categoryFilterSql, countByCategoryPath, renameCategoryPath, getCategoryTree, saveCategoryTree,
} from '../../src/utils/category-tree';

function db(): Database.Database {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE books (id TEXT PRIMARY KEY, category TEXT);`);
  return d;
}

describe('category tree', () => {
  it('default tree is valid and lists every path including intermediate nodes', () => {
    expect(validateCategoryTree(DEFAULT_CATEGORY_TREE)).toBeNull();
    const paths = categoryPaths(DEFAULT_CATEGORY_TREE);
    expect(paths.slice(0, 3)).toEqual(['小说', '小说/网络小说', '小说/网络小说/玄幻']);
    expect(paths).toContain('社科/心理学');
    expect(paths).toContain('其他');
  });

  it.each([
    [[], '分类表不能为空'],
    [[{ name: '' }], '分类名称不能为空'],
    [[{ name: 'a/b' }], '不能包含'],
    [[{ name: 'a,b' }], '不能包含'],
    [[{ name: 'A' }, { name: 'A' }], '重复'],
    [[{ name: 'a', children: [{ name: 'b', children: [{ name: 'c', children: [{ name: 'd' }] }] }] }], '最多 3 级'],
    [[{ name: ' a' }], '空格'],
  ])('rejects invalid tree %#', (tree, msg) => {
    expect(validateCategoryTree(tree)).toContain(msg);
  });

  it('allows the same name under different parents', () => {
    expect(validateCategoryTree([{ name: '小说', children: [{ name: '历史' }] }, { name: '历史' }])).toBeNull();
  });

  it('resolves AI output to a tree path', () => {
    const t = DEFAULT_CATEGORY_TREE;
    expect(resolveCategoryPath(t, '小说/中国古典小说')).toBe('小说/中国古典小说');
    expect(resolveCategoryPath(t, '小说 › 外国小说')).toBe('小说/外国小说');
    expect(resolveCategoryPath(t, '心理学')).toBe('社科/心理学');
    expect(resolveCategoryPath(t, '历史')).toBe('历史');            // 顶级本身就是合法路径
    expect(resolveCategoryPath(t, '网络小说/历史')).toBeUndefined(); // 末级「历史」有两处，不猜
    expect(resolveCategoryPath(t, '修真')).toBeUndefined();
    expect(resolveCategoryPath(t, '')).toBeUndefined();
    expect(isValidCategoryPath(t, '小说/网络小说')).toBe(true);
    expect(isValidCategoryPath(t, '网络小说')).toBe(false);
  });

  it('filters by path prefix with LIKE escaping', () => {
    const d = db();
    const ins = d.prepare('INSERT INTO books VALUES (?, ?)');
    [['1', '小说'], ['2', '小说/网络小说/玄幻'], ['3', '小说家'], ['4', '社科'], ['5', 'a_b/c'], ['6', 'axb/c']].forEach(r => ins.run(...r));
    const ids = (p: string) => {
      const f = categoryFilterSql(p);
      return (d.prepare(`SELECT id FROM books WHERE ${f.sql} ORDER BY id`).all(...f.params) as Array<{ id: string }>).map(r => r.id);
    };
    expect(ids('小说')).toEqual(['1', '2']);
    expect(ids('小说/网络小说')).toEqual(['2']);
    expect(ids('a_b')).toEqual(['5']);
  });

  it('counts books per path including descendants', () => {
    expect(countByCategoryPath([
      { category: '小说/网络小说/玄幻', n: 2 }, { category: '小说/外国小说', n: 1 }, { category: '其他', n: 3 },
    ])).toEqual({ '小说': 3, '小说/网络小说': 2, '小说/网络小说/玄幻': 2, '小说/外国小说': 1, '其他': 3 });
  });

  it('renames a path and its descendants only', () => {
    const d = db();
    const ins = d.prepare('INSERT INTO books VALUES (?, ?)');
    [['1', '小说/网络小说'], ['2', '小说/网络小说/玄幻'], ['3', '小说/网络小说家'], ['4', '其他']].forEach(r => ins.run(...r));
    expect(renameCategoryPath(d, '小说/网络小说', '小说/网文')).toBe(2);
    expect(d.prepare('SELECT category FROM books ORDER BY id').all().map((r: any) => r.category))
      .toEqual(['小说/网文', '小说/网文/玄幻', '小说/网络小说家', '其他']);
  });

  it('stores a custom tree and falls back to the default when missing or broken', () => {
    const d = db();
    expect(getCategoryTree(d)).toBe(DEFAULT_CATEGORY_TREE);
    saveCategoryTree(d, [{ name: '书', children: [] }]);
    expect(getCategoryTree(d)).toEqual([{ name: '书' }]);
    d.prepare("UPDATE settings SET value = 'not json' WHERE key = 'category_tree'").run();
    expect(getCategoryTree(d)).toBe(DEFAULT_CATEGORY_TREE);
  });
});
