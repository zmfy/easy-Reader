import { Router, Request, Response } from 'express';
import { getDb } from '../db';
import { opdsAuth } from '../middleware/opds-auth';
import { Book } from '../types';
import { resolveBookRealPath } from '../services/book-file';
import { categoryFilterSql } from '../utils/category-tree';
import {
  acquisitionFeed, navigationFeed, openSearchDescription, BookEntry, FeedLinks, NavEntry, OPDS_ACQ_TYPE, OPDS_NAV_TYPE,
} from '../services/opds-feed';
import {
  CatalogBook, OPDS_PAGE_SIZE, Page, VISIBLE_BOOK_SQL, categoryChildren, listAll, listAuthors, listByAuthor, listByCategory,
  listHistory, listRecent, listSeries, listSeriesBooks, listShelf, searchBooks,
} from '../services/opds-catalog';
import { availableDownloads, DownloadKind, resolveDownload } from '../services/opds-download';

// OPDS 1.2 书目源：阅读 App（KOReader、KyBook、静读天下等）用 HTTP Basic + OPDS 专用密码访问。
// 链接都是以 / 开头的路径，客户端按 feed 地址补全主机，反向代理后也不用配置。
const router = Router();
router.use(...opdsAuth);

const SEARCH = '/opds/opensearch.xml';
const ROOT = '/opds';

const nowIso = () => new Date().toISOString();
function toIso(dbTime: string | null | undefined): string {
  if (!dbTime) return nowIso();
  const t = Date.parse(dbTime.includes('T') ? dbTime : dbTime.replace(' ', 'T') + 'Z');
  return Number.isNaN(t) ? nowIso() : new Date(t).toISOString();
}

function pageParam(req: Request): number {
  const n = Number(req.query.page);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** 同一路径换一个 page 参数，其余查询参数保留 */
function withPage(pathname: string, query: Record<string, string>, page: number): string {
  const qs = new URLSearchParams({ ...query, page: String(page) }).toString();
  return `${pathname}?${qs}`;
}

function siteName(): string {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'site_name'").get() as { value: string } | undefined;
  return row?.value || '简单书房';
}

function sendXml(res: Response, type: string, xml: string): void {
  res.setHeader('Cache-Control', 'no-cache');
  res.type(type + '; charset=utf-8').send(xml);
}

const DOWNLOAD_TYPES: Record<DownloadKind, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
};

function bookEntry(b: CatalogBook): BookEntry {
  const kinds = availableDownloads(b);
  return {
    id: b.id,
    title: b.display_title || b.title,
    author: b.author,
    summary: b.summary,
    category: b.category,
    updated: toIso(b.imported_at),
    coverUrl: b.cover_url,
    acquisitions: kinds.map((k, i) => ({
      href: `/opds/books/${encodeURIComponent(b.id)}/download.${k}`,
      type: DOWNLOAD_TYPES[k],
      // TXT 的第二个链接是原文（第一个是转换后的 EPUB）
      title: k === 'txt' && i > 0 ? '原始 TXT' : undefined,
    })),
  };
}

function sendBooks(
  req: Request, res: Response, o: { id: string; title: string; pathname: string; query?: Record<string, string>; up?: string; page: Page<CatalogBook> },
): void {
  const query = o.query ?? {};
  const { page, total, items } = o.page;
  const lastPage = Math.max(1, Math.ceil(total / OPDS_PAGE_SIZE));
  const links: FeedLinks = {
    self: withPage(o.pathname, query, page),
    start: ROOT,
    up: o.up ?? ROOT,
    search: SEARCH,
    first: withPage(o.pathname, query, 1),
  };
  if (page > 1) links.previous = withPage(o.pathname, query, page - 1);
  if (page < lastPage) links.next = withPage(o.pathname, query, page + 1);
  sendXml(res, OPDS_ACQ_TYPE, acquisitionFeed({
    id: `urn:easyreader:${o.id}`, title: o.title, updated: nowIso(), links,
    entries: items.map(bookEntry), total, pageSize: OPDS_PAGE_SIZE, startIndex: (page - 1) * OPDS_PAGE_SIZE + 1,
  }));
}

function sendNav(
  res: Response, o: { id: string; title: string; self: string; up?: string; next?: string; previous?: string; entries: NavEntry[] },
): void {
  sendXml(res, OPDS_NAV_TYPE, navigationFeed({
    id: `urn:easyreader:${o.id}`, title: o.title, updated: nowIso(),
    links: { self: o.self, start: ROOT, up: o.up, next: o.next, previous: o.previous, search: SEARCH },
    entries: o.entries,
  }));
}

router.get('/', (_req, res) => {
  sendNav(res, {
    id: 'root', title: siteName(), self: ROOT,
    entries: [
      { id: 'urn:easyreader:recent', title: '最新入库', href: '/opds/recent', kind: 'acquisition', content: '最近加入书库的书' },
      { id: 'urn:easyreader:history', title: '最近在读', href: '/opds/history', kind: 'acquisition', content: '最近打开过的书' },
      { id: 'urn:easyreader:shelf', title: '我的书架', href: '/opds/shelf', kind: 'acquisition', content: '收藏到书架的书' },
      { id: 'urn:easyreader:categories', title: '分类', href: '/opds/categories', content: '按分类浏览' },
      { id: 'urn:easyreader:authors', title: '作者', href: '/opds/authors', content: '按作者浏览' },
      { id: 'urn:easyreader:series', title: '系列', href: '/opds/series', content: '按系列浏览' },
      { id: 'urn:easyreader:all', title: '全部书籍', href: '/opds/all', kind: 'acquisition', content: '按书名排序' },
    ],
  });
});

router.get('/opensearch.xml', (_req, res) => {
  sendXml(res, 'application/opensearchdescription+xml', openSearchDescription('/opds/search?q={searchTerms}'));
});

router.get('/recent', (req, res) => {
  sendBooks(req, res, { id: 'recent', title: '最新入库', pathname: '/opds/recent', page: listRecent(getDb(), pageParam(req)) });
});
router.get('/all', (req, res) => {
  sendBooks(req, res, { id: 'all', title: '全部书籍', pathname: '/opds/all', page: listAll(getDb(), pageParam(req)) });
});
router.get('/shelf', (req, res) => {
  sendBooks(req, res, { id: 'shelf', title: '我的书架', pathname: '/opds/shelf', page: listShelf(getDb(), req.user!.userId, pageParam(req)) });
});
router.get('/history', (req, res) => {
  sendBooks(req, res, { id: 'history', title: '最近在读', pathname: '/opds/history', page: listHistory(getDb(), req.user!.userId, pageParam(req)) });
});

router.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = q ? searchBooks(getDb(), q, pageParam(req)) : { items: [], total: 0, page: 1 };
  sendBooks(req, res, { id: 'search', title: q ? `搜索：${q}` : '搜索', pathname: '/opds/search', query: { q }, page });
});

router.get('/categories', (req, res) => {
  const path = typeof req.query.path === 'string' && req.query.path ? req.query.path : null;
  const db = getDb();
  const children = categoryChildren(db, path);
  const entries: NavEntry[] = [];
  if (path) {
    const filter = categoryFilterSql(path);
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM books WHERE ${VISIBLE_BOOK_SQL} AND ${filter.sql}`)
      .get(...filter.params) as { n: number }).n;
    entries.push({
      id: `urn:easyreader:category-all:${path}`, title: `全部（${total} 本）`, kind: 'acquisition', count: total,
      href: `/opds/categories/books?path=${encodeURIComponent(path)}`,
    });
  }
  for (const c of children) {
    entries.push({
      id: `urn:easyreader:category:${c.path}`, title: c.name, count: c.count,
      kind: c.hasChildren ? 'navigation' : 'acquisition',
      href: c.hasChildren ? `/opds/categories?path=${encodeURIComponent(c.path)}` : `/opds/categories/books?path=${encodeURIComponent(c.path)}`,
      content: `${c.count} 本`,
    });
  }
  const parent = path && path.includes('/') ? `/opds/categories?path=${encodeURIComponent(path.slice(0, path.lastIndexOf('/')))}` : (path ? '/opds/categories' : ROOT);
  sendNav(res, {
    id: path ? `categories:${path}` : 'categories', title: path ? path.split('/').pop()! : '分类',
    self: path ? `/opds/categories?path=${encodeURIComponent(path)}` : '/opds/categories', up: parent, entries,
  });
});

router.get('/categories/books', (req, res) => {
  const path = typeof req.query.path === 'string' ? req.query.path : '';
  sendBooks(req, res, {
    id: `category-books:${path}`, title: path.split('/').pop() || '分类', pathname: '/opds/categories/books', query: { path },
    up: `/opds/categories?path=${encodeURIComponent(path)}`, page: listByCategory(getDb(), path, pageParam(req)),
  });
});

function navPaging(pathname: string, page: number, total: number): { self: string; next?: string; previous?: string } {
  const last = Math.max(1, Math.ceil(total / OPDS_PAGE_SIZE));
  return {
    self: `${pathname}?page=${page}`,
    next: page < last ? `${pathname}?page=${page + 1}` : undefined,
    previous: page > 1 ? `${pathname}?page=${page - 1}` : undefined,
  };
}

router.get('/authors', (req, res) => {
  const p = listAuthors(getDb(), pageParam(req));
  sendNav(res, {
    id: 'authors', title: '作者', ...navPaging('/opds/authors', p.page, p.total),
    entries: p.items.map(a => ({
      id: `urn:easyreader:author:${a.author}`, title: a.author, kind: 'acquisition' as const, count: a.count, content: `${a.count} 本`,
      href: `/opds/authors/books?name=${encodeURIComponent(a.author)}`,
    })),
  });
});

router.get('/authors/books', (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  sendBooks(req, res, {
    id: `author:${name}`, title: name || '作者', pathname: '/opds/authors/books', query: { name }, up: '/opds/authors',
    page: listByAuthor(getDb(), name, pageParam(req)),
  });
});

router.get('/series', (req, res) => {
  const p = listSeries(getDb(), pageParam(req));
  sendNav(res, {
    id: 'series', title: '系列', ...navPaging('/opds/series', p.page, p.total),
    entries: p.items.map(s => ({
      id: `urn:easyreader:series:${s.id}`, title: s.name, kind: 'acquisition' as const, count: s.count, content: `${s.count} 本`,
      href: `/opds/series/${encodeURIComponent(s.id)}`,
    })),
  });
});

router.get('/series/:id', (req, res) => {
  const row = getDb().prepare('SELECT name FROM series WHERE id = ?').get(req.params.id) as { name: string } | undefined;
  sendBooks(req, res, {
    id: `series:${req.params.id}`, title: row?.name || '系列', pathname: `/opds/series/${encodeURIComponent(req.params.id)}`,
    up: '/opds/series', page: listSeriesBooks(getDb(), req.params.id, pageParam(req)),
  });
});

function notFound(res: Response, message = '书籍不存在'): void {
  res.status(404).type('text/plain; charset=utf-8').send(message);
}

// GET /opds/books/:id/download.:ext — 下载不算「在读」，不记阅读历史
router.get('/books/:id/download.:ext', async (req: Request, res: Response) => {
  const book = getDb().prepare(`SELECT * FROM books WHERE id = ? AND ${VISIBLE_BOOK_SQL}`).get(req.params.id) as Book | undefined;
  if (!book) { notFound(res); return; }
  const kind = req.params.ext as DownloadKind;
  if (!availableDownloads(book).includes(kind)) { notFound(res, '这本书不提供该格式'); return; }
  const realPath = resolveBookRealPath(book);
  if (!realPath) { notFound(res, '文件不存在'); return; }

  let download;
  try {
    download = await resolveDownload({ ...book, file_path: realPath }, kind);
  } catch (err) {
    // 错误信息可能带服务器上的文件路径，只写日志，对外给固定提示
    console.error(`[opds] 生成下载文件失败 book=${book.id} kind=${kind}:`, err);
    res.status(500).type('text/plain; charset=utf-8').send('生成下载文件失败，请稍后重试或联系管理员');
    return;
  }
  res.setHeader('Content-Type', download.mimeType);
  res.setHeader('Content-Disposition',
    `attachment; filename="book.${kind}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`);
  res.sendFile(download.filePath, { dotfiles: 'allow', headers: { 'Content-Type': download.mimeType } }, (err) => {
    if (err && !res.headersSent) notFound(res, '文件不存在');
  });
});

export default router;
