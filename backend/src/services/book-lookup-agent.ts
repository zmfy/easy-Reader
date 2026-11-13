import { DoubanBookHit, DoubanSubjectDetail } from '../utils/cover';
import { AdaptationCandidate } from '../utils/adaptation-sources';
import { extractJsonObject } from '../ai/json-extract';
import {
  Adaptation, ADAPTATION_JUDGE_RULES, describeAdaptationCandidate, toAdaptation,
} from './adaptations';

/**
 * AI 查证循环：像人一样多轮查询，认准这本书是豆瓣上的哪一本，再搜改编作品。
 * 每一轮把「规则 + 书的信息 + 到目前为止的操作和结果」发给 AI，AI 只回一个 JSON 动作，程序执行后进入下一轮。
 * 候选由程序编号（豆瓣书 B、影视 M、猫耳 D，整个循环内唯一），AI 只能按编号引用见过的候选，不能编造。
 * 纯逻辑：AI 调用和外部搜索都由调用方注入（deps），这里不碰网络和数据库。
 */

export const LOOKUP_LIMITS = { total: 8, identify: 5 };
/** 连续这么多次无效回答就放弃，调用方走兜底 */
const MAX_CONSECUTIVE_INVALID = 2;
const INTRO_MAX = 150;
const SUMMARY_MAX = 120;

export interface LookupInput {
  fileName: string;
  /** 文件内置书目信息摘要（EPUB 元数据等） */
  embedded?: string;
  title: string;
  author?: string;
  bookType?: string;
  summary?: string;
  /** 初步填充判定错标时的说明：此时查证的是正文实际的书 */
  mismatchReason?: string;
}

export type LookupStep =
  | { kind: 'search_book' | 'search_movie' | 'search_drama'; query: string; count: number; error?: boolean }
  | { kind: 'open_book'; id: string; label: string }
  | { kind: 'confirm_book'; id: string; label: string; why?: string }
  | { kind: 'no_book'; why?: string }
  | { kind: 'pick_adaptations'; count: number }
  | { kind: 'invalid' };

export interface ConfirmedBook {
  hit: DoubanBookHit;
  /** 书库里应显示的书名 */
  title: string;
  /** 规范化后的作者：保留国籍、不含译者 */
  author?: string;
  /** 豆瓣原文的作者写法（写进依据说明） */
  doubanAuthor?: string;
  why?: string;
  /** 打开过条目页时的详情 */
  detail?: DoubanSubjectDetail;
}

export interface LookupDeps {
  chat(prompt: string): Promise<string>;
  searchBook(q: string): Promise<DoubanBookHit[]>;
  openBook(url: string): Promise<DoubanSubjectDetail>;
  searchMovie(q: string): Promise<AdaptationCandidate[]>;
  searchDrama(q: string): Promise<AdaptationCandidate[]>;
  onStep?(steps: LookupStep[]): void;
  /** chat 抛出的错误是否要原样抛给调用方（额度 / 鉴权错误，批量要据此暂停）；否则按查证失败处理 */
  isFatal?(err: unknown): boolean;
}

export interface LookupAgentResult {
  /** failed = 连续无效回答或 chat 出错，调用方走兜底；次数用完不算 failed，只是该阶段没有结果 */
  status: 'ok' | 'failed';
  confirmed?: ConfirmedBook;
  noBook: boolean;
  seenBooks: DoubanBookHit[];
  adaptations: Adaptation[];
  steps: LookupStep[];
}

export type LookupAction =
  | { action: 'search_book' | 'search_movie' | 'search_drama'; query: string; why?: string }
  | { action: 'open_book'; id: string; why?: string }
  | { action: 'confirm_book'; id: string; title?: string; author?: string; why?: string }
  | { action: 'no_book'; why?: string }
  | { action: 'pick_adaptations'; ids: string[]; types: Record<string, string> }
  | { action: 'done' };

type Phase = 'identify' | 'adapt';

const PHASE_ACTIONS: Record<Phase, string[]> = {
  identify: ['search_book', 'open_book', 'confirm_book', 'no_book'],
  adapt: ['search_movie', 'search_drama', 'pick_adaptations', 'done'],
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 解析 AI 的一个动作；不认识、不属于当前阶段、引用未出现过的编号都返回 null（算一次无效回答） */
export function parseLookupAction(raw: string, phase: Phase, known: Set<string>): LookupAction | null {
  const obj = extractJsonObject(raw);
  const action = obj && str(obj.action);
  if (!obj || !action || !PHASE_ACTIONS[phase].includes(action)) return null;
  const why = str(obj.why);
  const withWhy = why ? { why } : {};
  switch (action) {
    case 'search_book':
    case 'search_movie':
    case 'search_drama': {
      const query = str(obj.query);
      return query ? { action, query, ...withWhy } : null;
    }
    case 'open_book':
    case 'confirm_book': {
      const id = str(obj.id);
      if (!id || !id.startsWith('B') || !known.has(id)) return null;
      if (action === 'open_book') return { action, id, ...withWhy };
      const title = str(obj.title);
      const author = str(obj.author);
      return { action, id, ...(title ? { title } : {}), ...(author ? { author } : {}), ...withWhy };
    }
    case 'no_book':
      return { action, ...withWhy };
    case 'pick_adaptations': {
      const ids = Array.isArray(obj.ids)
        ? [...new Set(obj.ids.filter((id): id is string => typeof id === 'string' && /^[MD]/.test(id) && known.has(id)))]
        : [];
      const types: Record<string, string> = {};
      if (obj.types && typeof obj.types === 'object') {
        for (const [id, t] of Object.entries(obj.types as Record<string, unknown>)) {
          if (ids.includes(id) && typeof t === 'string') types[id] = t;
        }
      }
      return { action, ids, types };
    }
    default:
      return { action: 'done' };
  }
}

/** 豆瓣作者写法 → 书库写法：保留国籍前缀，去掉译者和「著」，如「[英] J.R.R.托尔金 / 丁棣 译」→「[英] J.R.R.托尔金」 */
export function normalizeDoubanAuthor(raw: string): string {
  return raw.split('/')
    .map(s => s.trim())
    .filter(s => s && !/译$|译者/.test(s))
    .map(s => s.replace(/\s*(编著|著)$/, '').trim())
    .filter(Boolean)
    .join(' / ');
}

function bookLine(id: string, h: DoubanBookHit): string {
  return `[${id}] ${[h.title, h.author, h.year && `${h.year}年`].filter(Boolean).join(' | ')}`;
}

function detailLine(d: DoubanSubjectDetail): string {
  // 标签可能来自广告参数（混有作者名、国家），不可靠，不发给 AI
  return '条目详情：' + [
    d.author && `作者 ${d.author}`,
    d.translator && `译者 ${d.translator}`,
    d.publisher && `出版社 ${d.publisher}`,
    d.year && `${d.year}年`,
    d.intro && `简介：${d.intro.slice(0, INTRO_MAX)}`,
  ].filter(Boolean).join(' | ');
}

function bookLabel(h: DoubanBookHit, d?: DoubanSubjectDetail): string {
  const pub = [d?.publisher, d?.year || h.year].filter(Boolean).join(' ');
  return [h.title, d?.author || h.author, pub].filter(Boolean).join(' / ');
}

function bookInfo(input: LookupInput): string {
  return [
    `文件名：${input.fileName}`,
    input.embedded && `文件内置信息：${input.embedded}`,
    `初步判断的书名：${input.title}`,
    input.author && `初步判断的作者：${input.author}`,
    input.bookType && `类型：${input.bookType}`,
    input.summary && `简介：${input.summary.slice(0, SUMMARY_MAX)}`,
    input.mismatchReason && `注意：初步判断正文内容与文件名不符（${input.mismatchReason}），请查证正文实际是哪本书。`,
  ].filter(Boolean).join('\n');
}

const IDENTIFY_RULES = `你在帮图书管理员核实一本书是豆瓣上的哪一本。每次只做一步，只返回一个 JSON。
可用动作：
{"action":"search_book","query":"检索词","why":"原因"}  搜豆瓣书目
{"action":"open_book","id":"B1","why":"原因"}  打开条目，查看作者、译者、出版社、年份、简介
{"action":"confirm_book","id":"B1","title":"书名","author":"作者","why":"依据"}  确认是这一本
{"action":"no_book","why":"原因"}  豆瓣上没有这本书
规则：
- 可以换说法搜：原名、别名、译名、加上作者名；套装 / 全集搜不到时，试试单本书名或系列名。
- 确认前要比对作者，必要时先 open_book 看出版信息；只能引用下面出现过的编号。
- confirm_book 的 title 填这个文件在书库里应显示的书名（套装 / 全集保留整套名，去掉营销用语）；author 保留国籍前缀（如「[英] J.R.R.托尔金」），不含译者。
- 网络小说豆瓣常常没有条目，搜一两次没有就回 no_book，不要反复换词。`;

const ADAPT_RULES = `现在查这本书的影视 / 广播剧改编。每次只做一步，只返回一个 JSON。
可用动作：
{"action":"search_movie","query":"检索词"}  搜豆瓣影视（电影、剧集、动画）
{"action":"search_drama","query":"检索词"}  搜猫耳FM广播剧
{"action":"pick_adaptations","ids":["M1","D2"],"types":{"M1":"电影"}}  选定改编作品（选完即结束）
{"action":"done"}  没有改编，结束
规则：
- 检索词可以用书名、改编作品常用的译名或别名（如「魔戒」的电影叫「指环王」）。
- 候选是搜索得到的，混有同名或无关作品；只能从出现过的候选中选，用编号引用；确认是改编自这本书（含续作、分季、系列中的单部）才选，不确定就不选。
${ADAPTATION_JUDGE_RULES}`;

/** 执行查证循环：先认书（confirm_book / no_book），再查改编（pick_adaptations / done） */
export async function runBookLookup(input: LookupInput, deps: LookupDeps): Promise<LookupAgentResult> {
  const steps: LookupStep[] = [];
  const history: string[] = [];
  const books = new Map<string, DoubanBookHit>();
  const details = new Map<string, DoubanSubjectDetail>();
  const candidates = new Map<string, AdaptationCandidate>();
  const idByUrl = new Map<string, string>();
  let movieSeq = 0;
  let dramaSeq = 0;
  let confirmed: ConfirmedBook | undefined;
  let confirmedId = '';
  let noBook = false;
  let adaptations: Adaptation[] = [];
  let phase: Phase = 'identify';
  let total = 0;
  let identifyOps = 0;
  let invalidRun = 0;

  const known = () => new Set([...books.keys(), ...candidates.keys()]);
  const record = (step: LookupStep, line: string, extra: string[] = []) => {
    steps.push(step);
    history.push(line, ...extra.map(l => `  ${l}`));
    deps.onStep?.([...steps]);
  };
  const result = (status: 'ok' | 'failed'): LookupAgentResult => ({
    status, ...(confirmed ? { confirmed } : {}), noBook, seenBooks: [...books.values()], adaptations, steps,
  });

  const buildPrompt = () => {
    const left = phase === 'identify'
      ? Math.min(LOOKUP_LIMITS.identify - identifyOps, LOOKUP_LIMITS.total - total)
      : LOOKUP_LIMITS.total - total;
    const outcome = confirmed
      ? `已确认：[${confirmedId}] 《${confirmed.title}》${confirmed.author ? ` ${confirmed.author}` : ''}`
      : noBook ? '认书结论：豆瓣上没有这本书' : '';
    return [
      phase === 'identify' ? IDENTIFY_RULES : ADAPT_RULES,
      `【书】\n${bookInfo(input)}${phase === 'adapt' && outcome ? `\n${outcome}` : ''}`,
      `【已做的操作】\n${history.length ? history.join('\n') : '（无）'}`,
      `本阶段还剩 ${left} 次操作。只返回一个 JSON。`,
    ].join('\n\n');
  };

  while (total < LOOKUP_LIMITS.total) {
    if (phase === 'identify' && identifyOps >= LOOKUP_LIMITS.identify) phase = 'adapt';
    let raw: string;
    try {
      raw = await deps.chat(buildPrompt());
    } catch (err) {
      if (deps.isFatal?.(err)) throw err;
      return result('failed');
    }
    total++;
    if (phase === 'identify') identifyOps++;

    const action = parseLookupAction(raw, phase, known());
    if (!action) {
      record({ kind: 'invalid' }, '（上一次回答无效：不是可用的 JSON 动作，或引用了不存在的编号）');
      if (++invalidRun >= MAX_CONSECUTIVE_INVALID) return result('failed');
      continue;
    }
    invalidRun = 0;

    switch (action.action) {
      case 'search_book': {
        let hits: DoubanBookHit[];
        try {
          hits = await deps.searchBook(action.query);
        } catch {
          record({ kind: 'search_book', query: action.query, count: 0, error: true }, `搜豆瓣书「${action.query}」→ 搜索失败`);
          break;
        }
        const lines = hits.map(h => {
          let id = idByUrl.get(h.url);
          if (!id) {
            id = `B${books.size + 1}`;
            idByUrl.set(h.url, id);
            books.set(id, h);
          }
          return bookLine(id, h);
        });
        record({ kind: 'search_book', query: action.query, count: hits.length }, `搜豆瓣书「${action.query}」→ ${hits.length} 条`, lines);
        break;
      }
      case 'open_book': {
        const hit = books.get(action.id)!;
        let detail: DoubanSubjectDetail | undefined;
        try {
          detail = await deps.openBook(hit.url);
          details.set(action.id, detail);
        } catch { /* 打开失败只记在历史里，由 AI 决定下一步 */ }
        record({ kind: 'open_book', id: action.id, label: bookLabel(hit, detail) }, `打开 ${action.id}`,
          [detail ? detailLine(detail) : '打开失败']);
        break;
      }
      case 'confirm_book': {
        const hit = books.get(action.id)!;
        const detail = details.get(action.id);
        const doubanAuthor = hit.author || detail?.author;
        const author = normalizeDoubanAuthor(action.author || doubanAuthor || '');
        confirmedId = action.id;
        confirmed = {
          hit, title: action.title || hit.title,
          ...(author ? { author } : {}),
          ...(doubanAuthor ? { doubanAuthor } : {}),
          ...(action.why ? { why: action.why } : {}),
          ...(detail ? { detail } : {}),
        };
        record({ kind: 'confirm_book', id: action.id, label: bookLabel(hit, detail), ...(action.why ? { why: action.why } : {}) },
          `确认 ${action.id}：《${confirmed.title}》${author ? ` ${author}` : ''}`);
        phase = 'adapt';
        break;
      }
      case 'no_book':
        noBook = true;
        record({ kind: 'no_book', ...(action.why ? { why: action.why } : {}) }, `认书结论：豆瓣上没有这本书${action.why ? `（${action.why}）` : ''}`);
        phase = 'adapt';
        break;
      case 'search_movie':
      case 'search_drama': {
        const isMovie = action.action === 'search_movie';
        let found: AdaptationCandidate[];
        try {
          found = await (isMovie ? deps.searchMovie : deps.searchDrama)(action.query);
        } catch {
          record({ kind: action.action, query: action.query, count: 0, error: true },
            `搜${isMovie ? '豆瓣影视' : '猫耳FM'}「${action.query}」→ 搜索失败`);
          break;
        }
        const lines = found.map(c => {
          let id = idByUrl.get(c.url);
          if (!id) {
            id = isMovie ? `M${++movieSeq}` : `D${++dramaSeq}`;
            idByUrl.set(c.url, id);
            candidates.set(id, c);
          }
          return `[${id}] ${describeAdaptationCandidate(c)}`;
        });
        record({ kind: action.action, query: action.query, count: found.length },
          `搜${isMovie ? '豆瓣影视' : '猫耳FM'}「${action.query}」→ ${found.length} 条`, lines);
        break;
      }
      case 'pick_adaptations':
        adaptations = action.ids.map(id => toAdaptation(candidates.get(id)!, action.types[id]));
        record({ kind: 'pick_adaptations', count: adaptations.length }, `选定改编 ${adaptations.length} 部`);
        return result('ok');
      case 'done':
        return result('ok');
    }
  }
  return result('ok');
}
