import { request } from './cover';

/**
 * 改编作品候选来源：豆瓣电影（电影 / 剧集 / 动画）、猫耳 FM（广播剧）。
 * 都是网页端搜索接口（非官方开放 API），失败一律返回 []，不影响填充。
 * 候选只按书名匹配，必然混有同名、无关作品，由 AI 结合书目信息筛选（services/adaptations.ts）。
 */

export type AdaptationSource = 'douban' | 'missevan';

export interface AdaptationCandidate {
  source: AdaptationSource;
  title: string;
  year?: string;
  /** 豆瓣：集数（有集数通常是剧集） */
  episodes?: string;
  /** 猫耳：原著作者 */
  author?: string;
  /** 猫耳：简介开头（常写明「某某原著」） */
  abstract?: string;
  url: string;
}

const CANDIDATE_LIMIT = 10;

const isDoubanMovieHost = (h: string) => h === 'movie.douban.com';
const isMissevanHost = (h: string) => h === 'www.missevan.com';

/** 改编作品链接白名单：豆瓣影视条目 movie.douban.com/subject/<数字>/、猫耳广播剧 www.missevan.com/mdrama/<数字> */
export function isAllowedAdaptationUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
  return (isDoubanMovieHost(u.hostname) && /^\/subject\/\d+\/?$/.test(u.pathname))
    || (isMissevanHost(u.hostname) && /^\/mdrama\/\d+\/?$/.test(u.pathname));
}

export function parseDoubanMovieSuggest(json: string): AdaptationCandidate[] {
  let items: unknown;
  try { items = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(items)) return [];
  return items
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .filter(s => typeof s.title === 'string' && s.title && /^\d+$/.test(String(s.id ?? '')))
    .slice(0, CANDIDATE_LIMIT)
    .map(s => ({
      source: 'douban' as const,
      title: s.title as string,
      ...(typeof s.year === 'string' && s.year ? { year: s.year } : {}),
      ...(typeof s.episode === 'string' && s.episode ? { episodes: s.episode } : {}),
      url: `https://movie.douban.com/subject/${s.id}/`,
    }));
}

export function parseMissevanSearch(json: string): AdaptationCandidate[] {
  let data: unknown;
  try { data = (JSON.parse(json) as { info?: { Datas?: unknown } })?.info?.Datas; } catch { return []; }
  if (!Array.isArray(data)) return [];
  return data
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .filter(d => typeof d.name === 'string' && d.name && Number.isInteger(d.id))
    .slice(0, CANDIDATE_LIMIT)
    .map(d => ({
      source: 'missevan' as const,
      title: d.name as string,
      ...(typeof d.author === 'string' && d.author.trim() ? { author: d.author.trim() } : {}),
      ...(typeof d.abstract === 'string' && d.abstract.trim()
        ? { abstract: d.abstract.replace(/\s+/g, ' ').trim().slice(0, 80) } : {}),
      url: `https://www.missevan.com/mdrama/${d.id}`,
    }));
}

export async function searchDoubanMovies(title: string): Promise<AdaptationCandidate[]> {
  try {
    const buf = await request(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(title)}`, {
      'Accept': 'application/json, text/javascript, */*',
      'Referer': 'https://movie.douban.com/',
    }, 4, isDoubanMovieHost);
    return parseDoubanMovieSuggest(buf.toString('utf-8'));
  } catch {
    return [];
  }
}

export async function searchMissevanDramas(title: string): Promise<AdaptationCandidate[]> {
  try {
    const buf = await request(`https://www.missevan.com/dramaapi/search?s=${encodeURIComponent(title)}&page=1`, {
      'Accept': 'application/json',
    }, 4, isMissevanHost);
    return parseMissevanSearch(buf.toString('utf-8'));
  } catch {
    return [];
  }
}
