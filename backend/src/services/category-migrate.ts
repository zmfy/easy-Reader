import Database from 'better-sqlite3';
import { aiManager } from '../ai/ai-manager';
import {
  CategoryNode, categoryPaths, getCategoryTree, isValidCategoryPath, resolveCategoryPath,
} from '../utils/category-tree';

/**
 * 旧分类整理：分类不在分类树里的书（旧版单级分类、分类树删改后遗留的），给出新路径建议，
 * 用户在设置页确认后才写入。
 *
 * 映射表只收无歧义的网文类型词。「玄幻」「言情」「历史」「科幻」等在旧数据里常被误用
 * （如《西游记》→玄幻、《傲慢与偏见》→言情），一律交给 AI 结合书名、作者、简介重新判断。
 */

const UNAMBIGUOUS_MAP: Record<string, string> = {
  '修真': '小说/网络小说/仙侠修真',
  '仙侠': '小说/网络小说/仙侠修真',
  '仙侠修真': '小说/网络小说/仙侠修真',
  '都市': '小说/网络小说/都市',
  '游戏': '小说/网络小说/游戏',
  '轻小说': '小说/网络小说/轻小说',
};

const AI_BATCH_SIZE = 10;

export interface LegacyCategoryBook {
  id: string;
  title: string;
  author: string | null;
  category: string;
}

export interface CategorySuggestion extends LegacyCategoryBook {
  suggested?: string;
  source?: 'map' | 'ai';
}

const REVIEW_KEY = 'category_review_ids';

/** 多级分类上线时记录的单级旧分类书（db.ts 迁移写入），确认前都算待整理 */
function getReviewIds(db: Database.Database): Set<string> {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(REVIEW_KEY) as { value?: string } | undefined;
  try {
    const ids = JSON.parse(row?.value ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** 这些书的分类已由用户确认或修改，移出待整理 */
export function markCategoriesReviewed(db: Database.Database, bookIds: string[]): void {
  const ids = getReviewIds(db);
  if (!bookIds.some(id => ids.has(id))) return;
  bookIds.forEach(id => ids.delete(id));
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(JSON.stringify([...ids]), REVIEW_KEY);
}

export function listLegacyCategoryBooks(db: Database.Database): LegacyCategoryBook[] {
  const tree = getCategoryTree(db);
  const review = getReviewIds(db);
  const rows = db.prepare(
    `SELECT id, title, author, category FROM books
     WHERE category IS NOT NULL AND TRIM(category) != '' AND status = 'normal'
       AND (duplicate_of IS NULL OR duplicate_of = '')
     ORDER BY title`
  ).all() as LegacyCategoryBook[];
  return rows.filter(r => review.has(r.id) || !isValidCategoryPath(tree, r.category));
}

export function buildCategorizePrompt(
  tree: CategoryNode[],
  books: Array<{ title: string; author?: string | null; summary?: string | null; category?: string | null }>,
): string {
  const lines = books.map((b, i) => [
    `[#${i}] 《${b.title}》`,
    b.author && `作者：${b.author}`,
    b.category && `旧分类：${b.category}（可能不准）`,
    b.summary && `简介：${b.summary.replace(/\s+/g, ' ').slice(0, 120)}`,
  ].filter(Boolean).join(' | ')).join('\n');
  return `你是个人书库的图书管理员。请为下面每本书从分类表中选一个最贴切的分类路径（尽量选到最细一级）。
注意区分网络小说与出版物：四大名著等古典小说归「小说/中国古典小说」，外国名著归「小说/外国小说」，不要因为题材归到网络小说。
拿不准时选上一级（如「小说」），完全无法判断选「其他」。

【分类表】
${categoryPaths(tree).join('\n')}

【书】
${lines}

只返回 JSON：{"items":[{"index":0,"category":"小说/中国古典小说"}]}`;
}

export function parseCategorizeResponse(raw: string, tree: CategoryNode[], total: number): Map<number, string> {
  const out = new Map<number, string>();
  let items: unknown;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    items = m ? (JSON.parse(m[0]) as { items?: unknown }).items : undefined;
  } catch {
    return out;
  }
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    const { index, category } = (item ?? {}) as { index?: unknown; category?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= total) continue;
    const path = resolveCategoryPath(tree, typeof category === 'string' ? category : undefined);
    if (path) out.set(index, path);
  }
  return out;
}

/** 映射表能对应的直接给出；其余按批交给 AI（某一批失败只是那批没有建议，不影响其他） */
export async function suggestLegacyCategories(db: Database.Database): Promise<CategorySuggestion[]> {
  const tree = getCategoryTree(db);
  const books = listLegacyCategoryBooks(db);
  const result: CategorySuggestion[] = books.map(b => {
    const mapped = UNAMBIGUOUS_MAP[b.category.trim()];
    return mapped && isValidCategoryPath(tree, mapped) ? { ...b, suggested: mapped, source: 'map' } : { ...b };
  });

  const pending = result.filter(r => !r.suggested);
  if (pending.length === 0) return result;
  const summaries = new Map(
    (db.prepare(`SELECT id, summary FROM books WHERE id IN (${pending.map(() => '?').join(',')})`)
      .all(...pending.map(p => p.id)) as Array<{ id: string; summary: string | null }>).map(r => [r.id, r.summary]),
  );
  for (let i = 0; i < pending.length; i += AI_BATCH_SIZE) {
    const batch = pending.slice(i, i + AI_BATCH_SIZE);
    try {
      const raw = await aiManager.chat(
        buildCategorizePrompt(tree, batch.map(b => ({ ...b, summary: summaries.get(b.id) }))),
        db,
        { reasoningEffort: 'low' },
      );
      for (const [index, path] of parseCategorizeResponse(raw, tree, batch.length)) {
        batch[index].suggested = path;
        batch[index].source = 'ai';
      }
    } catch {
      // 这一批没有建议，用户可手动选择
    }
  }
  return result;
}

/** 写入用户确认的分类；路径必须在分类树中。不锁字段（与采纳 AI 结果一致）。返回写入数 */
export function applyCategories(db: Database.Database, items: Array<{ book_id: string; category: string }>): number {
  const tree = getCategoryTree(db);
  const invalid = items.find(i => !isValidCategoryPath(tree, i.category));
  if (invalid) throw new Error(`分类「${invalid.category}」不在分类表中`);
  const stmt = db.prepare('UPDATE books SET category = ? WHERE id = ?');
  let changed = 0;
  db.transaction(() => {
    for (const i of items) changed += stmt.run(i.category, i.book_id).changes;
    markCategoriesReviewed(db, items.map(i => i.book_id));
  })();
  return changed;
}
