import Database from 'better-sqlite3';
import { Book } from '../types';
import { withDisplayTitle } from '../utils/book-view';
import { CATEGORY_SEPARATOR, CategoryNode, categoryFilterSql, countByCategoryPath, getCategoryTree } from '../utils/category-tree';

// OPDS 各目录的查询。只列「可见的书」，与书库列表的默认条件一致（重复、乱码、损坏的不列）
export const OPDS_PAGE_SIZE = 50;
export const VISIBLE_BOOK_SQL = "(status IS NULL OR status NOT IN ('duplicate','garbled','damaged','pending_review'))";
const VISIBLE_B = "(b.status IS NULL OR b.status NOT IN ('duplicate','garbled','damaged','pending_review'))";

export interface Page<T> { items: T[]; total: number; page: number }
export type CatalogBook = Book & { display_title?: string };

const BY_TITLE = 'clean_title(title) ASC, title ASC';

function normPage(page: number): number {
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

function pageOfBooks(db: Database.Database, where: string, params: unknown[], orderBy: string, page: number): Page<CatalogBook> {
  const p = normPage(page);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM books WHERE ${VISIBLE_BOOK_SQL} AND ${where}`).get(...params) as { n: number }).n;
  const items = db.prepare(`SELECT * FROM books WHERE ${VISIBLE_BOOK_SQL} AND ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, OPDS_PAGE_SIZE, (p - 1) * OPDS_PAGE_SIZE) as Book[];
  return { items: withDisplayTitle(items), total, page: p };
}

function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, c => `\\${c}`);
}

export function listRecent(db: Database.Database, page: number): Page<CatalogBook> {
  return pageOfBooks(db, '1=1', [], 'imported_at DESC, rowid DESC', page);
}

export function listAll(db: Database.Database, page: number): Page<CatalogBook> {
  return pageOfBooks(db, '1=1', [], BY_TITLE, page);
}

export function searchBooks(db: Database.Database, q: string, page: number): Page<CatalogBook> {
  const like = `%${likeEscape(q)}%`;
  return pageOfBooks(db, "(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')", [like, like], BY_TITLE, page);
}

/** 按用户关联表（书架、阅读历史）列书，按 orderColumn 倒序 */
function pageOfUserBooks(db: Database.Database, table: 'shelf' | 'reading_history', orderColumn: string, userId: string, page: number): Page<CatalogBook> {
  const p = normPage(page);
  const from = `FROM ${table} r JOIN books b ON b.id = r.book_id WHERE r.user_id = ? AND ${VISIBLE_B}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(userId) as { n: number }).n;
  const items = db.prepare(`SELECT b.* ${from} ORDER BY r.${orderColumn} DESC, r.rowid DESC LIMIT ? OFFSET ?`)
    .all(userId, OPDS_PAGE_SIZE, (p - 1) * OPDS_PAGE_SIZE) as Book[];
  return { items: withDisplayTitle(items), total, page: p };
}

export function listShelf(db: Database.Database, userId: string, page: number): Page<CatalogBook> {
  return pageOfUserBooks(db, 'shelf', 'added_at', userId, page);
}

export function listHistory(db: Database.Database, userId: string, page: number): Page<CatalogBook> {
  return pageOfUserBooks(db, 'reading_history', 'opened_at', userId, page);
}

export function listByCategory(db: Database.Database, path: string, page: number): Page<CatalogBook> {
  const filter = categoryFilterSql(path);
  return pageOfBooks(db, filter.sql, filter.params, BY_TITLE, page);
}

/** 某分类（null 为顶级）的直接下级，按分类表顺序；没有书的分类不列 */
export function categoryChildren(
  db: Database.Database, path: string | null,
): Array<{ path: string; name: string; count: number; hasChildren: boolean }> {
  let nodes: CategoryNode[] = getCategoryTree(db);
  if (path) {
    for (const name of path.split(CATEGORY_SEPARATOR)) {
      const next = nodes.find(n => n.name === name);
      if (!next) return [];
      nodes = next.children ?? [];
    }
  }
  const rows = db.prepare(
    `SELECT category, COUNT(*) AS n FROM books WHERE ${VISIBLE_BOOK_SQL} AND category IS NOT NULL AND category != '' GROUP BY category`
  ).all() as Array<{ category: string; n: number }>;
  const counts = countByCategoryPath(rows);
  const result: Array<{ path: string; name: string; count: number; hasChildren: boolean }> = [];
  for (const node of nodes) {
    const full = path ? `${path}${CATEGORY_SEPARATOR}${node.name}` : node.name;
    const count = counts[full] ?? 0;
    if (count === 0) continue;
    const hasChildren = (node.children ?? []).some(c => (counts[`${full}${CATEGORY_SEPARATOR}${c.name}`] ?? 0) > 0);
    result.push({ path: full, name: node.name, count, hasChildren });
  }
  return result;
}

export function listAuthors(db: Database.Database, page: number): Page<{ author: string; count: number }> {
  const p = normPage(page);
  const where = `WHERE ${VISIBLE_BOOK_SQL} AND author IS NOT NULL AND TRIM(author) != ''`;
  const total = (db.prepare(`SELECT COUNT(DISTINCT author) AS n FROM books ${where}`).get() as { n: number }).n;
  const items = db.prepare(`SELECT author, COUNT(*) AS count FROM books ${where} GROUP BY author ORDER BY author LIMIT ? OFFSET ?`)
    .all(OPDS_PAGE_SIZE, (p - 1) * OPDS_PAGE_SIZE) as Array<{ author: string; count: number }>;
  return { items, total, page: p };
}

export function listByAuthor(db: Database.Database, author: string, page: number): Page<CatalogBook> {
  return pageOfBooks(db, 'author = ?', [author], BY_TITLE, page);
}

export function listSeries(db: Database.Database, page: number): Page<{ id: string; name: string; count: number }> {
  const p = normPage(page);
  const from = `FROM series s JOIN books b ON b.series_id = s.id WHERE ${VISIBLE_B}`;
  const total = (db.prepare(`SELECT COUNT(DISTINCT s.id) AS n ${from}`).get() as { n: number }).n;
  const items = db.prepare(`SELECT s.id, s.name, COUNT(*) AS count ${from} GROUP BY s.id ORDER BY s.name LIMIT ? OFFSET ?`)
    .all(OPDS_PAGE_SIZE, (p - 1) * OPDS_PAGE_SIZE) as Array<{ id: string; name: string; count: number }>;
  return { items, total, page: p };
}

export function listSeriesBooks(db: Database.Database, seriesId: string, page: number): Page<CatalogBook> {
  return pageOfBooks(db, 'series_id = ?', [seriesId], 'title ASC', page);
}
