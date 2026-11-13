import Database from 'better-sqlite3';

/** 这个文件之前被跳过过，且路径、大小、修改时间都没变 */
export function isSkippedUnchanged(db: Database.Database, filePath: string, size: number, mtime: number): boolean {
  const row = db.prepare('SELECT file_size, file_mtime FROM scan_skipped_files WHERE file_path = ?')
    .get(filePath) as { file_size: number; file_mtime: number | null } | undefined;
  return !!row && row.file_size === size && row.file_mtime === mtime;
}

export function recordSkip(
  db: Database.Database,
  p: { file_path: string; file_size: number; file_mtime: number | null },
): void {
  db.prepare(
    `INSERT INTO scan_skipped_files (file_path, file_size, file_mtime, skipped_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(file_path) DO UPDATE SET
       file_size = excluded.file_size, file_mtime = excluded.file_mtime, skipped_at = CURRENT_TIMESTAMP`
  ).run(p.file_path, p.file_size, p.file_mtime);
}

export function clearSkip(db: Database.Database, filePath: string): void {
  db.prepare('DELETE FROM scan_skipped_files WHERE file_path = ?').run(filePath);
}
