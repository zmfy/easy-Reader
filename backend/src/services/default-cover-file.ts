import Database from 'better-sqlite3';
import { renderDefaultCoverSvg } from '../utils/default-cover';
import { saveCoverFile } from '../utils/cover';
import { cleanBookTitle } from '../utils/book-title';

/**
 * 默认封面文件：豆瓣找不到封面时（批量填充）、用户在预览里选「默认封面」时（单本应用）、
 * 给没有封面的书补齐时共用。只生成文件并返回地址，写不写库由调用方决定。
 */
export interface DefaultCoverBook {
  id: string;
  title: string;
  author?: string | null;
  category?: string | null;
}

export function createDefaultCover(
  book: DefaultCoverBook,
  override: { title?: string | null; author?: string | null; category?: string | null } = {},
): string {
  const svg = renderDefaultCoverSvg({
    title: override.title?.trim() || cleanBookTitle(book.title),
    author: override.author ?? book.author,
    category: override.category ?? book.category,
  });
  return saveCoverFile(book.id, svg, 'svg');
}

const MISSING_COVER_WHERE = `status = 'normal' AND (duplicate_of IS NULL OR duplicate_of = '')
  AND (cover_url IS NULL OR cover_url = '')`;

/** 没有封面的书（正常、非重复） */
export function countMissingCovers(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM books WHERE ${MISSING_COVER_WHERE}`).get() as { n: number }).n;
}

/** 给所有没有封面的书生成默认封面；本地生成，不调用 AI、不请求外网。返回生成数量 */
export function fillMissingDefaultCovers(db: Database.Database): number {
  const books = db.prepare(`SELECT id, title, author, category FROM books WHERE ${MISSING_COVER_WHERE}`).all() as DefaultCoverBook[];
  const set = db.prepare("UPDATE books SET cover_url = ? WHERE id = ? AND (cover_url IS NULL OR cover_url = '')");
  let n = 0;
  for (const b of books) {
    if (set.run(createDefaultCover(b), b.id).changes > 0) n++;
  }
  return n;
}
