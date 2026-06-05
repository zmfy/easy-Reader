import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const COVERS_DIR = path.join(DATA_DIR, 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

function request(url: string, headers: Record<string, string> = {}, redirects = 4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
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
          : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
        res.resume();
        resolve(request(next, headers, redirects - 1));
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

/** Download the cover image for an already-fetched suggest item. Returns /covers/… or undefined. */
export async function downloadCover(item: DoubanSuggest, bookId: string): Promise<string | undefined> {
  try {
    if (!item.pic || item.pic.includes('book-default')) return undefined;
    const imgUrl = item.pic
      .replace('/spic/', '/lpic/')
      .replace('/view/subject/s/', '/view/subject/l/')
      .replace('/view/subject/m/', '/view/subject/l/');
    const imgBuf = await request(imgUrl, {
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Referer': 'https://book.douban.com/',
    });
    if (imgBuf.length < 1024) return undefined;
    const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] ?? 'jpg';
    const filename = `${bookId}.${ext}`;
    fs.writeFileSync(path.join(COVERS_DIR, filename), imgBuf);
    return `/covers/${filename}`;
  } catch {
    return undefined;
  }
}

/** Pure: extract the douban rating number from a subject page's HTML. */
export function parseDoubanRating(html: string): number | undefined {
  const m = html.match(/rating_num"[^>]*>\s*([\d.]+)\s*</);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Fetch + parse the douban rating from a suggest item's subject page. */
export async function fetchRating(item: DoubanSuggest): Promise<number | undefined> {
  try {
    if (!item.url) return undefined;
    const buf = await request(item.url, {
      'Accept': 'text/html,application/xhtml+xml',
      'Referer': 'https://book.douban.com/',
    });
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
