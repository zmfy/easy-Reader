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
