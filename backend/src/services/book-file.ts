import { Book } from '../types';
import { resolveRealPathInsideRoot } from '../utils/path-safe';
import { organizedDir } from './txt-organize/writer';

const BOOKS_DIR = process.env.BOOKS_DIR || '/app/books';

/**
 * 书籍文件的真实路径（解析符号链接后）：在书库目录内，或是整理版（organized_from 不为空）且在整理版目录内；
 * 否则 null。数据目录里的其他文件（数据库、封面、证书等）即使被登记成书也读不到。
 */
export function resolveBookRealPath(book: Pick<Book, 'file_path' | 'organized_from'>): string | null {
  const inBooks = resolveRealPathInsideRoot(BOOKS_DIR, book.file_path);
  if (inBooks) return inBooks;
  return book.organized_from ? resolveRealPathInsideRoot(organizedDir(), book.file_path) : null;
}
