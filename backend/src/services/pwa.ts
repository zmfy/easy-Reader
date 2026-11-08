// PWA：动态 Web App Manifest（名称跟随网站名称）与「上次读的书」
import Database from 'better-sqlite3';

const DEFAULT_NAME = '简单书房';
const SHORT_NAME_MAX = 12;

export function buildManifest(siteName: string): Record<string, unknown> {
  const name = siteName.trim() || DEFAULT_NAME;
  return {
    name,
    short_name: Array.from(name).slice(0, SHORT_NAME_MAX).join(''),
    start_url: '/continue',
    scope: '/',
    display: 'standalone',
    theme_color: '#4338ca',
    background_color: '#eef1f6',
    lang: 'zh-CN',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

/** 当前用户最近更新阅读进度、且仍存在的书；没有 → null（不判断是否读完） */
export function getLastReadBookId(db: Database.Database, userId: string): string | null {
  const row = db.prepare(
    `SELECT rp.book_id FROM reading_progress rp JOIN books b ON b.id = rp.book_id
      WHERE rp.user_id = ? ORDER BY rp.updated_at DESC LIMIT 1`
  ).get(userId) as { book_id: string } | undefined;
  return row ? row.book_id : null;
}
