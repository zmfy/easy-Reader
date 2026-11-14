import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { unescapeHtml } from './html';

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

const isMaoerImageHost = (h: string) => h === 'static.maoercdn.com';
const isCoverImageHost = (h: string) => isDoubanImageHost(h) || isMaoerImageHost(h);

/** 可作封面的图片：豆瓣图片（书封 / 影视海报）或猫耳 FM 广播剧封面 */
export function isAllowedCoverImageUrl(url: string): boolean {
  const u = parseUrl(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && !u.port && isCoverImageHost(u.hostname);
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
  /** 改编作品的封面（海报 / 广播剧封面）：电视剧、电影、广播剧等；豆瓣书封不带 */
  kind?: string;
}

interface DoubanSuggest {
  url?: string;
  pic?: string;
  title?: string;
  author_name?: string;
  year?: string;
  /** b = 书，a = 作者（联想结果里会混入作者条目，图片是作者照片） */
  type?: string;
}

/** 联想结果里只要书：去掉作者条目（type 为 a），否则作者照片会被当成封面 */
function isBookItem(s: DoubanSuggest | null | undefined): s is DoubanSuggest {
  return !!s && s.type !== 'a';
}

/** Pure: pick the best book item from a douban suggest response (prefers one with a real cover). */
export function pickDoubanBook(items: unknown): DoubanSuggest | undefined {
  if (!Array.isArray(items)) return undefined;
  const books = (items as DoubanSuggest[]).filter(isBookItem);
  return books.find(s => s.pic && !s.pic.includes('book-default')) ?? books[0];
}

/**
 * Pure: 豆瓣联想按书名匹配，「魔戒全集」这类带合集后缀的书名常常一条都搜不到。
 * 返回去掉合集后缀（全集、合集、套装、系列、三部曲、全 N 册）后的检索词；没有可去的后缀时返回 undefined。
 * 作品集 / 文集不去：剩下的多半是作者名，搜出来是作者的其他书。
 */
export function doubanFallbackQuery(title: string): string | undefined {
  const stripped = title
    .replace(/[\s·・\-_]*[(（]?(全集|合集|套装|系列|三部曲|全[\d一二三四五六七八九十]+[册卷本部])[)）]?\s*$/, '')
    .trim();
  return stripped && stripped !== title.trim() ? stripped : undefined;
}

async function fetchDoubanSuggest(query: string): Promise<unknown> {
  const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  const buf = await request(apiUrl, {
    'Accept': 'application/json, text/javascript, */*',
    'Referer': 'https://book.douban.com/',
  }, 4, isDoubanBookHost);
  return JSON.parse(buf.toString('utf-8'));
}

/** 联想请求；书名搜不到任何书时，去掉合集后缀再搜一次 */
async function fetchDoubanSuggestWithFallback(title: string): Promise<unknown> {
  const items = await fetchDoubanSuggest(title);
  if (Array.isArray(items) && (items as DoubanSuggest[]).some(isBookItem)) return items;
  const fallback = doubanFallbackQuery(title);
  return fallback ? fetchDoubanSuggest(fallback) : items;
}

/** One suggest request; returns the best book item (prefers one with a real cover), or undefined. */
export async function doubanSuggest(title: string): Promise<DoubanSuggest | undefined> {
  try {
    return pickDoubanBook(await fetchDoubanSuggestWithFallback(title));
  } catch {
    return undefined;
  }
}

/** Pure: parse a douban suggest response into cover candidates (real covers only). */
export function parseDoubanSuggestList(json: string, limit = 6): DoubanCandidate[] {
  let items: unknown;
  try { items = JSON.parse(json); } catch { return []; }
  return toDoubanCandidates(items, limit);
}

function toDoubanCandidates(items: unknown, limit: number): DoubanCandidate[] {
  if (!Array.isArray(items)) return [];
  return (items as DoubanSuggest[])
    .filter(s => isBookItem(s) && typeof s.pic === 'string' && s.pic && !s.pic.includes('book-default'))
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
    return toDoubanCandidates(await fetchDoubanSuggestWithFallback(title), limit);
  } catch {
    return [];
  }
}

/** AI 查证用的豆瓣书目命中（只含书条目；封面是 book-default 时省略 pic） */
export interface DoubanBookHit {
  title: string;
  author?: string;
  year?: string;
  pic?: string;
  url: string;
}

/** Pure: 解析豆瓣联想结果为书目命中（保留无封面的书，与封面候选不同） */
export function parseDoubanBookHits(json: string, limit = 10): DoubanBookHit[] {
  let items: unknown;
  try { items = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(items)) return [];
  return (items as DoubanSuggest[])
    .filter(s => isBookItem(s) && !!s.url)
    .slice(0, limit)
    .map(s => ({
      title: s.title || '',
      ...(s.author_name ? { author: s.author_name } : {}),
      ...(s.year ? { year: s.year } : {}),
      ...(s.pic && !s.pic.includes('book-default') ? { pic: s.pic } : {}),
      url: s.url!,
    }));
}

/** 按检索词搜豆瓣书目；出错抛出，由调用方记录 */
export async function searchDoubanBooks(query: string): Promise<DoubanBookHit[]> {
  return parseDoubanBookHits(JSON.stringify(await fetchDoubanSuggest(query)));
}

/** 豆瓣条目页的详情（AI 查证用） */
export interface DoubanSubjectDetail {
  author?: string;
  translator?: string;
  publisher?: string;
  year?: string;
  intro?: string;
  tags: string[];
  rating?: number;
}

const DOUBAN_INTRO_MAX = 150;

function htmlToText(html: string): string {
  return unescapeHtml(html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

/** Pure: 从豆瓣条目页 HTML 提取作者 / 译者 / 出版社 / 年份 / 简介 / 标签 / 评分；缺失的字段留空，不抛错 */
export function parseDoubanSubjectDetail(html: string): DoubanSubjectDetail {
  const detail: DoubanSubjectDetail = { tags: [] };

  const info = html.match(/id="info"[^>]*>([\s\S]*?)<\/div>/);
  if (info) {
    const fields: Record<string, string> = {};
    for (const line of info[1].split(/<br\s*\/?>/i)) {
      const text = htmlToText(line);
      const m = text.match(/^([^:：]+)[:：]\s*(.+)$/);
      if (m) fields[m[1].trim()] = m[2].trim();
    }
    if (fields['作者']) detail.author = fields['作者'];
    if (fields['译者']) detail.translator = fields['译者'];
    if (fields['出版社']) detail.publisher = fields['出版社'];
    const year = (fields['出版年'] || fields['出版时间'] || '').match(/\d{4}/);
    if (year) detail.year = year[0];
  }

  // 只取 #link-report 里第一个 .intro 块（折叠页是 short 摘要，未折叠页就是全文），避免越界读到后面的页面文字
  const report = html.match(/id="link-report"[\s\S]*?<div class="intro">([\s\S]*?)<\/div>/);
  if (report) {
    const intro = htmlToText(report[1]);
    if (intro) detail.intro = intro.slice(0, DOUBAN_INTRO_MAX);
  }

  const tagsSection = html.match(/id="db-tags-section"[\s\S]*?(?=<div id=|$)/);
  if (tagsSection) {
    for (const m of tagsSection[0].matchAll(/<a[^>]*class="[^"]*\btag\b[^"]*"[^>]*>([^<]+)<\/a>/g)) detail.tags.push(m[1].trim());
  }
  if (!detail.tags.length) {
    // 未登录的条目页没有 #db-tags-section，标签只在广告参数 criteria = '7:奇幻|7:小说|3:/subject/..' 里
    const criteria = html.match(/criteria\s*=\s*'([^']*)'/);
    if (criteria) {
      detail.tags = criteria[1].split('|').filter(t => t.startsWith('7:')).map(t => t.slice(2).trim()).filter(Boolean);
    }
  }

  const rating = parseDoubanRating(html);
  if (rating !== undefined) detail.rating = rating;
  return detail;
}

/** 抓取并解析豆瓣条目页；url 必须是豆瓣书条目页，否则抛错 */
export async function fetchDoubanSubjectDetail(url: string): Promise<DoubanSubjectDetail> {
  if (!isAllowedDoubanSubjectUrl(url)) throw new Error('不是允许的豆瓣条目页地址');
  const buf = await request(url, {
    'Accept': 'text/html,application/xhtml+xml',
    'Referer': 'https://book.douban.com/',
  }, 4, isDoubanBookHost);
  return parseDoubanSubjectDetail(buf.toString('utf-8'));
}

const IMAGE_HEADERS = {
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
  'Referer': 'https://book.douban.com/',
};

/** 图片请求头：猫耳图床拒绝带豆瓣 Referer 的请求，按域名分别设置 */
function imageHeadersFor(url: string): Record<string, string> {
  return isMaoerImageHost(parseUrl(url)?.hostname ?? '')
    ? { ...IMAGE_HEADERS, Referer: 'https://www.missevan.com/' }
    : IMAGE_HEADERS;
}

function withSize(pic: string, size: 'm' | 'l'): string {
  // 猫耳封面原图是 640px PNG（约 700KB），用图床的缩放参数转成 jpg（缩略图约 40KB）
  if (isMaoerImageHost(parseUrl(pic)?.hostname ?? '')) {
    return `${pic.split('?')[0]}?x-oss-process=image/${size === 'm' ? 'resize,w_300/' : ''}format,jpg`;
  }
  return pic
    .replace('/spic/', size === 'l' ? '/lpic/' : '/mpic/')
    .replace(/\/photo\/s_ratio_poster\//, `/photo/${size}_ratio_poster/`)
    .replace(/\/view\/subject\/[sml]\//, `/view/subject/${size}/`);
}

function imageExt(url: string): string {
  if (url.includes('format,jpg')) return 'jpg';
  return (url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
}

/** 下载候选封面的中图，返回 data URI（预览用，不落盘）；不在白名单或失败时返回 undefined。 */
export async function fetchCoverThumbnailDataUri(pic: string): Promise<string | undefined> {
  if (!isAllowedCoverImageUrl(pic)) return undefined;
  try {
    const url = withSize(pic, 'm');
    const buf = await request(url, imageHeadersFor(url), 4, isCoverImageHost);
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

/** 下载封面大图并保存（豆瓣书封 / 影视海报、猫耳封面）；pic 不在白名单或下载失败时返回 undefined。 */
export async function downloadCoverFromPic(pic: string, bookId: string): Promise<string | undefined> {
  if (!isAllowedCoverImageUrl(pic) || pic.includes('book-default')) return undefined;
  try {
    const url = withSize(pic, 'l');
    const buf = await request(url, imageHeadersFor(url), 4, isCoverImageHost);
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
