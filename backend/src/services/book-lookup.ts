import Database from 'better-sqlite3';
import { aiManager } from '../ai/ai-manager';
import {
  DoubanBookHit, DoubanCandidate, doubanSuggestList, fetchDoubanSubjectDetail, searchDoubanBooks,
} from '../utils/cover';
import { searchDoubanMovies, searchMissevanDramas } from '../utils/adaptation-sources';
import { throttled } from '../utils/external-throttle';
import { Adaptation, findAdaptations } from './adaptations';
import {
  ConfirmedBook, LookupDeps, LookupInput, LookupStep, runBookLookup,
} from './book-lookup-agent';

/**
 * AI 查证的对外入口：把真实检索 / AI 接进查证循环，处理开关、节流和兜底。
 * 关闭开关或循环失败时走兜底 = 原有行为（豆瓣封面候选 + 单次改编检索），保证填充不因查证而失败。
 */

const SETTING_KEY = 'ai_lookup_enabled';
const MAX_COVER_CANDIDATES = 6;

export interface LookupOutcome {
  confirmed?: ConfirmedBook & { rating?: number };
  noBook: boolean;
  coverCandidates: DoubanCandidate[];
  adaptations: Adaptation[];
  steps: LookupStep[];
  usedFallback: boolean;
}

/** 缺省或非 '0' 都视为开启 */
export function isLookupEnabled(db: Database.Database): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value?: string } | undefined;
  return row?.value !== '0';
}

function toCandidate(h: DoubanBookHit): DoubanCandidate {
  return {
    title: h.title,
    ...(h.author ? { author: h.author } : {}),
    ...(h.year ? { year: h.year } : {}),
    pic: h.pic!,
    subjectUrl: h.url,
  };
}

/** 已确认条目排第一，其余见过的带封面条目按出现顺序，去重，最多 6 个 */
function pickCoverCandidates(confirmed: ConfirmedBook | undefined, seen: DoubanBookHit[]): DoubanCandidate[] {
  const urls = new Set<string>();
  const out: DoubanCandidate[] = [];
  for (const h of [...(confirmed ? [confirmed.hit] : []), ...seen]) {
    if (!h.pic || urls.has(h.url)) continue;
    urls.add(h.url);
    out.push(toCandidate(h));
    if (out.length >= MAX_COVER_CANDIDATES) break;
  }
  return out;
}

async function fallback(
  input: LookupInput, db: Database.Database, throttle: boolean | undefined, steps: LookupStep[],
): Promise<LookupOutcome> {
  const [coverCandidates, adaptations] = await Promise.all([
    doubanSuggestList(input.title),
    findAdaptations({ title: input.title, author: input.author, summary: input.summary }, db, { throttle }),
  ]);
  return { noBook: false, coverCandidates, adaptations, steps, usedFallback: true };
}

/** throttle：后台批量时为 true，外部检索排队并保持间隔（AI 调用不受限） */
export async function lookupBook(
  input: LookupInput,
  db: Database.Database,
  opts: { throttle?: boolean; onStep?: (steps: LookupStep[]) => void; isFatal?: (err: unknown) => boolean } = {},
): Promise<LookupOutcome> {
  if (!isLookupEnabled(db)) return fallback(input, db, opts.throttle, []);

  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    (...args: A): Promise<R> => (opts.throttle ? throttled(() => fn(...args)) : fn(...args));
  const deps: LookupDeps = {
    chat: prompt => aiManager.chat(prompt, db, { reasoningEffort: 'low' }),
    searchBook: wrap(searchDoubanBooks),
    openBook: wrap(fetchDoubanSubjectDetail),
    searchMovie: wrap(searchDoubanMovies),
    searchDrama: wrap(searchMissevanDramas),
    ...(opts.onStep ? { onStep: opts.onStep } : {}),
    ...(opts.isFatal ? { isFatal: opts.isFatal } : {}),
  };
  const res = await runBookLookup(input, deps);
  if (res.status === 'failed') return fallback(input, db, opts.throttle, res.steps);

  const rating = res.confirmed?.detail?.rating;
  return {
    ...(res.confirmed ? { confirmed: { ...res.confirmed, ...(rating !== undefined ? { rating } : {}) } } : {}),
    noBook: res.noBook,
    coverCandidates: pickCoverCandidates(res.confirmed, res.seenBooks),
    adaptations: res.adaptations,
    steps: res.steps,
    usedFallback: false,
  };
}
