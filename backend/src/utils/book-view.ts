import { cleanBookTitle } from './book-title';
import { Request } from 'express';

/**
 * 普通用户不需要、也不应看到书籍文件在服务器上的绝对路径（会暴露目录结构）；
 * 管理员页面（问题书籍、扫描审核等）仍需要路径。
 */
export function hideFilePathForNonAdmin<T extends object>(req: Request, data: T): T;
export function hideFilePathForNonAdmin<T extends object>(req: Request, data: T[]): T[];
export function hideFilePathForNonAdmin<T extends object>(req: Request, data: T | T[]): T | T[] {
  if (req.user?.role === 'admin') return data;
  const strip = (row: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { file_path, ...rest } = row as T & { file_path?: unknown };
    return rest as T;
  };
  return Array.isArray(data) ? data.map(strip) : strip(data);
}

/**
 * 给书籍附加 display_title（清洗掉版本标记、作者等后的书名），供界面显示；
 * 原 title 保持不变（搜索、排序、文件识别仍用它）。
 */
export function withDisplayTitle<T extends object>(data: T[]): Array<T & { display_title?: string }>;
export function withDisplayTitle<T extends object>(data: T): T & { display_title?: string };
export function withDisplayTitle<T extends object>(data: T | T[]): (T & { display_title?: string }) | Array<T & { display_title?: string }> {
  const add = (row: T) => {
    const title = (row as { title?: unknown }).title;
    return typeof title === 'string' ? { ...row, display_title: cleanBookTitle(title) } : row;
  };
  return Array.isArray(data) ? data.map(add) : add(data);
}
