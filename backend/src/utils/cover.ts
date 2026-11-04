import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

/**
 * GET 请求。allowHost 用于主机白名单：初始地址与每一跳重定向都会检查，
 * 防止被诱导访问内网或任意地址（SSRF）。
 */
export function request(
  url: string,
  headers: Record<string, string> = {},
  redirects = 4,
  allowHost?: (hostname: string) => boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (allowHost && !allowHost(parsed.hostname)) {
      reject(new Error(`host not allowed: ${parsed.hostname}`));
      return;
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || undefined,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        ...headers,
      },
      timeout: 12000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode!) && res.headers.location && redirects > 0) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
        res.resume();
        resolve(request(next, headers, redirects - 1, allowHost));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

const isDoubanImageHost = (h: string) => /^img\d+\.doubanio\.com$/.test(h);
const isDoubanBookHost = (h: string) => h === 'book.douban.com';

function parseUrl(url: string): URL | undefined {
  try { return new URL(url); } catch { return undefined; }
}

/** 豆瓣封面图片：https://img<数字>.doubanio.com/… */
export function isAllowedDoubanImageUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && !u.port && isDoubanImageHost(u.hostname);
}

/** 豆瓣书目页：https://book.douban.com/subject/<数字>/… */
export function isAllowedDoubanSubjectUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && !u.port
    && isDoubanBookHost(u.hostname) && /^\/subject\/\d+(\/|$)/.test(u.pathname);
}

/** 豆瓣封面候选（AI 填充预览用） */
export interface DoubanCandidate {
  title: string;
  author?: string;
  year?: string;
  pic: string;
  subjectUrl?: string;
}

interface DoubanSuggest {
  url?: string;
  pic?: string;
  title?: string;
  author_name?: string;
  year?: string;
}

/** One suggest request; returns the best book item (prefers one with a real cover), or undefined. */
export async function doubanSuggest(title: string): Promise<DoubanSuggest | undefined> {
  try {
    const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`;
    const buf = await request(apiUrl, {
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://book.douban.com/',
    });
    const suggestions = JSON.parse(buf.toString('utf-8')) as DoubanSuggest[];
    if (!Array.isArray(suggestions) || suggestions.length === 0) return undefined;
    return suggestions.find(s => s.pic && !s.pic.includes('book-default')) ?? suggestions[0];
  } catch {
    return undefined;
  }
}

/** Pure: parse a douban suggest response into cover candidates (real covers only). */
export function parseDoubanSuggestList(json: string, limit = 6): DoubanCandidate[] {
  let items: unknown;
  try { items = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(items)) return [];
  return (items as DoubanSuggest[])
    .filter(s => s && typeof s.pic === 'string' && s.pic && !s.pic.includes('book-default'))
    .slice(0, limit)
    .map(s => ({
      title: s.title || '',
      ...(s.author_name ? { author: s.author_name } : {}),
      ...(s.year ? { year: s.year } : {}),
      pic: s.pic!,
      ...(s.url ? { subjectUrl: s.url } : {}),
    }));
}

/** 搜索豆瓣，返回最多 limit 个带封面的候选；出错时返回 []。 */
export async function doubanSuggestList(title: string, limit = 6): Promise<DoubanCandidate[]> {
  try {
    const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`;
    const buf = await request(apiUrl, {
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://book.douban.com/',
    }, 4, isDoubanBookHost);
    return parseDoubanSuggestList(buf.toString('utf-8'), limit);
  } catch {
    return [];
  }
}

const IMAGE_HEADERS = {
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
  'Referer': 'https://book.douban.com/',
};

function withSize(pic: string, size: 'm' | 'l'): string {
  return pic
    .replace('/spic/', size === 'l' ? '/lpic/' : '/mpic/')
    .replace(/\/view\/subject\/[sml]\//, `/view/subject/${size}/`);
}

function imageExt(url: string): string {
  return (url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
}

/** 下载候选封面的中图，返回 data URI（预览用，不落盘）；不在白名单或失败时返回 undefined。 */
export async function fetchCoverThumbnailDataUri(pic: string): Promise<string | undefined> {
  if (!isAllowedDoubanImageUrl(pic)) return undefined;
  try {
    const url = withSize(pic, 'm');
    const buf = await request(url, IMAGE_HEADERS, 4, isDoubanImageHost);
    if (buf.length < 1024) return undefined;
    const ext = imageExt(url);
    return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/**
 * 保存封面文件：文件名带版本号（浏览器不会显示旧缓存），并删除这本书之前的封面文件。
 * 返回 /covers/<文件名>。
 */
export function saveCoverFile(bookId: string, data: Buffer | string, ext: string): string {
  const filename = `${bookId}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`;
  fs.writeFileSync(path.join(COVERS_DIR, filename), data);
  for (const f of fs.readdirSync(COVERS_DIR)) {
    if (f !== filename && (f.startsWith(`${bookId}.`) || f.startsWith(`${bookId}-`))) {
      fs.rmSync(path.join(COVERS_DIR, f), { force: true });
    }
  }
  return `/covers/${filename}`;
}

/** 下载豆瓣封面大图并保存；pic 不在白名单或下载失败时返回 undefined。 */
export async function downloadCoverFromPic(pic: string, bookId: string): Promise<string | undefined> {
  if (!isAllowedDoubanImageUrl(pic) || pic.includes('book-default')) return undefined;
  try {
    const url = withSize(pic, 'l');
    const buf = await request(url, IMAGE_HEADERS, 4, isDoubanImageHost);
    if (buf.length < 1024) return undefined;
    return saveCoverFile(bookId, buf, imageExt(url));
  } catch {
    return undefined;
  }
}

/** Download the cover image for an already-fetched suggest item. Returns /covers/… or undefined. */
export async function downloadCover(item: DoubanSuggest, bookId: string): Promise<string | undefined> {
  if (!item.pic) return undefined;
  return downloadCoverFromPic(item.pic, bookId);
}

/** Pure: extract the douban rating number from a subject page's HTML. */
export function parseDoubanRating(html: string): number | undefined {
  // Live markup is `class="ll rating_num " property="v:average"> 8.9 <` — note the
  // space before the closing quote, so don't require a quote right after rating_num.
  const m = html.match(/rating_num[^>]*>\s*([\d.]+)\s*</);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Fetch + parse the douban rating from a suggest item's subject page. */
export async function fetchRating(item: DoubanSuggest): Promise<number | undefined> {
  try {
    if (!item.url || !isAllowedDoubanSubjectUrl(item.url)) return undefined;
    const buf = await request(item.url, {
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://book.douban.com/',
    }, 4, isDoubanBookHost);
    return parseDoubanRating(buf.toString('utf-8'));
  } catch {
    return undefined;
  }
}

/** Backwards-compatible wrapper used by the single-book cover-test endpoint. */
export async function fetchAndSaveCover(title: string, bookId: string): Promise<string | undefined> {
  const item = await doubanSuggest(title);
  if (!item) return undefined;
  return downloadCover(item, bookId);
}
