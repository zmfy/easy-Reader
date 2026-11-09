import Database from 'better-sqlite3';
import { aiManager } from '../ai/ai-manager';
import {
  AdaptationCandidate, AdaptationSource, searchDoubanMovies, searchMissevanDramas,
} from '../utils/adaptation-sources';
import { extractJsonObject } from '../ai/json-extract';

/**
 * 改编作品：先从豆瓣电影、猫耳 FM 按书名搜出候选，再由 AI 结合书目信息挑出真正改编自这本书的。
 * AI 只能从候选里选（按编号引用），不能自己添加，避免编造不存在的改编。
 */

export const ADAPTATION_TYPES = ['电影', '电视剧', '短剧', '动画', '广播剧', '其他'] as const;
export type AdaptationType = typeof ADAPTATION_TYPES[number];

export interface Adaptation {
  type: AdaptationType;
  title: string;
  year?: string;
  source: AdaptationSource;
  url: string;
  /** 海报 / 封面（只在预览里作封面候选，不入库） */
  pic?: string;
}

export interface AdaptationBookInfo {
  title: string;
  author?: string;
  summary?: string;
}

/**
 * 微短剧的特征：几十上百集、每集几分钟、近几年上线。豆瓣搜索接口不给单集片长，只能按集数和年份初筛，
 * 在提示里标出「可能是短剧」，由 AI 结合片名、年代排除长篇电视剧（如 1994 年 84 集的《三国演义》）。
 */
const SHORT_DRAMA_MIN_EPISODES = 50;
const SHORT_DRAMA_SINCE_YEAR = 2019;

export function looksLikeShortDrama(c: AdaptationCandidate): boolean {
  return c.source === 'douban'
    && Number(c.episodes) >= SHORT_DRAMA_MIN_EPISODES
    && Number(c.year) >= SHORT_DRAMA_SINCE_YEAR;
}

const SOURCE_LABELS: Record<AdaptationSource, string> = { douban: '豆瓣影视', missevan: '猫耳FM广播剧' };

export function buildAdaptationPrompt(book: AdaptationBookInfo, candidates: AdaptationCandidate[]): string {
  const lines = candidates.map((c, i) => {
    const extra = [
      SOURCE_LABELS[c.source],
      c.year && `${c.year}年`,
      c.episodes && `${c.episodes}集`,
      looksLikeShortDrama(c) && '集数多且年份新，可能是短剧',
      c.author && `原著作者：${c.author}`,
      c.abstract && `简介：${c.abstract}`,
    ].filter(Boolean).join(' | ');
    return `[#${i}] ${c.title} | ${extra}`;
  }).join('\n');
  return `判断下面哪些影视 / 广播剧作品改编自这本书。候选是按书名搜索得到的，混有同名或无关作品。

【书】《${book.title}》${book.author ? ` 作者：${book.author}` : ''}
${book.summary ? `简介：${book.summary.slice(0, 300)}\n` : ''}
【候选】
${lines}

只返回 JSON：{"adaptations":[{"index":0,"type":"电视剧"}]}
规则：
- 只能从候选中选，用编号 index 引用；确认是改编自这本书（含续作、分季、系列中的单部）才选，不确定就不选。
- 同名但题材、年代、原著作者对不上的不选；纪录片、综艺、解说、配音片段、同人二创不选。
- type 取 ${ADAPTATION_TYPES.join(' / ')}；猫耳FM 的一律为广播剧。
- 短剧（微短剧）指每集几分钟、几十上百集、近几年在短剧平台上线的竖屏剧，type 选「短剧」；集数多但每集是正常时长的长篇电视剧（多为较早年代或知名剧集）仍选「电视剧」。拿不准时选「电视剧」。
- 没有改编就返回 {"adaptations":[]}。`;
}

export function parseAdaptationResponse(raw: string, candidates: AdaptationCandidate[]): Adaptation[] {
  const items: unknown = extractJsonObject(raw)?.adaptations;
  if (!Array.isArray(items)) return [];
  const seen = new Set<number>();
  const out: Adaptation[] = [];
  for (const item of items) {
    const index = (item as { index?: unknown })?.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || seen.has(index)) continue;
    const c = candidates[index];
    if (!c) continue;
    seen.add(index);
    const rawType = (item as { type?: unknown }).type;
    const type: AdaptationType = c.source === 'missevan'
      ? '广播剧'
      : (ADAPTATION_TYPES as readonly unknown[]).includes(rawType) ? rawType as AdaptationType : '其他';
    out.push({
      type, title: c.title, ...(c.year ? { year: c.year } : {}), source: c.source, url: c.url,
      ...(c.pic ? { pic: c.pic } : {}),
    });
  }
  return out;
}

/** 搜不到候选时不调用 AI；任何一步失败都返回 []（改编信息是锦上添花，不能让填充失败） */
export async function findAdaptations(book: AdaptationBookInfo, db: Database.Database): Promise<Adaptation[]> {
  if (!book.title.trim()) return [];
  const [douban, missevan] = await Promise.all([searchDoubanMovies(book.title), searchMissevanDramas(book.title)]);
  const candidates = [...douban, ...missevan];
  if (candidates.length === 0) return [];
  try {
    // 只是从候选里挑选，不需要深度推理
    const raw = await aiManager.chat(buildAdaptationPrompt(book, candidates), db, { reasoningEffort: 'low' });
    return parseAdaptationResponse(raw, candidates);
  } catch {
    return [];
  }
}
