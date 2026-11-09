import Database from 'better-sqlite3';

/**
 * 多级分类：书的分类存路径（如「小说/网络小说/玄幻」），按前缀检索，选上级即包含全部下级。
 * 分类树存在 settings 表 category_tree（JSON），未设置时用内置默认树；管理员可在设置页编辑。
 */

export interface CategoryNode {
  name: string;
  children?: CategoryNode[];
}

export const CATEGORY_SEPARATOR = '/';
export const CATEGORY_MAX_DEPTH = 3;
const MAX_NODES = 300;
const MAX_NAME_LENGTH = 20;
const SETTINGS_KEY = 'category_tree';

const leaves = (names: string[]): CategoryNode[] => names.map(name => ({ name }));

export const DEFAULT_CATEGORY_TREE: CategoryNode[] = [
  {
    name: '小说',
    children: [
      { name: '网络小说', children: leaves(['玄幻', '仙侠修真', '都市', '历史', '科幻', '悬疑', '言情', '武侠', '游戏', '轻小说']) },
      { name: '中国古典小说' },
      { name: '中国现当代小说' },
      { name: '外国小说' },
    ],
  },
  { name: '文学', children: leaves(['散文随笔', '诗词', '文集全集', '传记']) },
  { name: '历史', children: leaves(['中国史', '世界史']) },
  { name: '社科', children: leaves(['心理学', '哲学', '社会学', '经济金融', '法律']) },
  { name: '国学', children: leaves(['经典', '佛道']) },
  { name: '科普', children: leaves(['科普', '军事兵器', '科技']) },
  { name: '生活', children: leaves(['成长励志', '健康']) },
  { name: '漫画' },
  { name: '其他' },
];

/** 校验分类树结构；返回错误说明，合法时返回 null */
export function validateCategoryTree(tree: unknown): string | null {
  if (!Array.isArray(tree) || tree.length === 0) return '分类表不能为空';
  let count = 0;
  const walk = (nodes: unknown[], depth: number): string | null => {
    const seen = new Set<string>();
    for (const node of nodes) {
      if (!node || typeof node !== 'object') return '分类格式不正确';
      const { name, children } = node as { name?: unknown; children?: unknown };
      if (typeof name !== 'string' || !name.trim()) return '分类名称不能为空';
      if (name !== name.trim()) return `分类「${name}」首尾不能有空格`;
      if (name.length > MAX_NAME_LENGTH) return `分类「${name}」超过 ${MAX_NAME_LENGTH} 个字`;
      if (/[/,，]/.test(name)) return `分类「${name}」不能包含「/」或逗号`;
      if (seen.has(name)) return `同一级下有重复的分类「${name}」`;
      seen.add(name);
      if (++count > MAX_NODES) return `分类总数不能超过 ${MAX_NODES} 个`;
      if (children !== undefined) {
        if (!Array.isArray(children)) return '分类格式不正确';
        if (children.length > 0) {
          if (depth >= CATEGORY_MAX_DEPTH) return `分类最多 ${CATEGORY_MAX_DEPTH} 级`;
          const err = walk(children, depth + 1);
          if (err) return err;
        }
      }
    }
    return null;
  };
  return walk(tree, 1);
}

/** 只保留 name / children，去掉空 children（存储与返回给前端都用这个形状） */
export function normalizeCategoryTree(tree: CategoryNode[]): CategoryNode[] {
  return tree.map(n => (n.children && n.children.length > 0
    ? { name: n.name, children: normalizeCategoryTree(n.children) }
    : { name: n.name }));
}

export function getCategoryTree(db: Database.Database): CategoryNode[] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY) as { value?: string } | undefined;
  if (row?.value) {
    try {
      const parsed = JSON.parse(row.value);
      if (!validateCategoryTree(parsed)) return normalizeCategoryTree(parsed);
    } catch { /* 损坏时退回默认 */ }
  }
  return DEFAULT_CATEGORY_TREE;
}

export function saveCategoryTree(db: Database.Database, tree: CategoryNode[]): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(SETTINGS_KEY, JSON.stringify(normalizeCategoryTree(tree)));
}

/** 全部路径（含中间节点），先序：小说、小说/网络小说、小说/网络小说/玄幻 … */
export function categoryPaths(tree: CategoryNode[], prefix = ''): string[] {
  const out: string[] = [];
  for (const node of tree) {
    const path = prefix ? `${prefix}${CATEGORY_SEPARATOR}${node.name}` : node.name;
    out.push(path);
    if (node.children) out.push(...categoryPaths(node.children, path));
  }
  return out;
}

export function isValidCategoryPath(tree: CategoryNode[], path: string): boolean {
  return categoryPaths(tree).includes(path);
}

/**
 * AI 给出的分类转成树中路径：本身就是合法路径直接用；否则按末级名唯一匹配
 * （「玄幻」→「小说/网络小说/玄幻」）；匹配不到或同名末级不止一个时返回 undefined。
 */
export function resolveCategoryPath(tree: CategoryNode[], raw: string | undefined): string | undefined {
  const value = (raw ?? '').trim().replace(/\s*[›>／]\s*/g, CATEGORY_SEPARATOR);
  if (!value) return undefined;
  const paths = categoryPaths(tree);
  if (paths.includes(value)) return value;
  const leaf = value.split(CATEGORY_SEPARATOR).pop()!;
  const matches = paths.filter(p => p.split(CATEGORY_SEPARATOR).pop() === leaf);
  return matches.length === 1 ? matches[0] : undefined;
}

/** 按分类检索的 SQL 条件：本分类及全部下级（LIKE 转义 % _ \） */
export function categoryFilterSql(path: string, column = 'category'): { sql: string; params: string[] } {
  const escaped = path.replace(/[\\%_]/g, c => `\\${c}`);
  return {
    sql: `(${column} = ? OR ${column} LIKE ? ESCAPE '\\')`,
    params: [path, `${escaped}${CATEGORY_SEPARATOR}%`],
  };
}

/** 各路径（含下级）的书数 */
export function countByCategoryPath(rows: Array<{ category: string; n: number }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { category, n } of rows) {
    const parts = category.split(CATEGORY_SEPARATOR);
    for (let i = 1; i <= parts.length; i++) {
      const key = parts.slice(0, i).join(CATEGORY_SEPARATOR);
      counts[key] = (counts[key] ?? 0) + n;
    }
  }
  return counts;
}

/** 分类改名：把 from 及其下级批量改成 to（事务由调用方控制）；返回受影响的书数 */
export function renameCategoryPath(db: Database.Database, from: string, to: string): number {
  if (!from || !to || from === to) return 0;
  const { sql, params } = categoryFilterSql(from);
  return db.prepare(`UPDATE books SET category = ? || substr(category, ?) WHERE ${sql}`)
    .run(to, from.length + 1, ...params).changes;
}
