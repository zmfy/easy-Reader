import Database from 'better-sqlite3';
import { aiManager } from '../../ai/ai-manager';
import { extractJsonObject } from '../../ai/json-extract';
import { Candidate } from './candidates';

export type LabelType = 'part' | 'volume' | 'chapter' | 'duplicate' | 'noise';

export interface Label {
  id: number;
  type: LabelType;
  /** noise 必有 */
  noiseKind?: 'stray_number' | 'text';
  /** 仅 chapter 可选：AI 指出这一章开始了新的一卷，卷名原样摘自该行（已校验是原行去空白后的连续子串） */
  volumeTitle?: string;
}

export interface JudgeResult {
  /** 与 candidates 一一对应、按 id 排序 */
  labels: Label[];
  notes: string[];
  batches: number;
}

export const JUDGE_BATCH_SIZE = 300;
export const JUDGE_OVERLAP = 20;

const LABEL_TYPES: LabelType[] = ['part', 'volume', 'chapter', 'duplicate', 'noise'];
const SUMMARY_CHAPTERS = 5;

const INSTRUCTIONS = `你是中文网络小说 TXT 的目录整理助手。下面给出从书中「疑似标题」的候选行（只有候选行，没有正文），请给每一行打一个标签。

标签类型（type）：
- part：「部」级标题，例如单独一行的「第二部」，或「第一部 xxx」。
- volume：「卷」级标题，例如「第一卷 xxx」；同一行同时带部和卷的（如「第一部第一卷《精绝古城》」）标为 volume，不要拆成两行。
- chapter：真正的章节标题（「第12章 xxx」「楔子」「番外」等），后面通常跟着一段正常篇幅的正文。chapter 不一定以「第…章」开头，「183 古格银眼」这类「数字＋章名」的行也可能是章节标题。
- duplicate：同一个标题被重复写了第二遍。例：「第5章 怎么像找对象？」后面紧接「第0005章怎么像找对象？？」，后一行是 duplicate（前一行才是 chapter）。
- noise：不是标题的行，必须再给 noiseKind：
  - stray_number：正文里夹杂的另一套编号，整行只有「第N章」之类、没有章名，且编号不大于前面已出现的有名章节编号。例：已有「第二章 青牛镇」后又出现孤零零的「第2章」。
  - text：恰好以「第」「《」等开头、但其实是正文句子或说明的行。例：「第二卷《山水郎》结束。」「第三回合他输了……」；以「第…回」开头的句子也是 text。

判断时请充分利用每行给出的 bodyChars / bodyLines（到下一候选行之间的正文字数 / 行数）和 prev / next 前后文片段：真正的章节后面通常有几百字以上的正文，正文极短或为 0 的候选行更可能是 noise 或 duplicate；hint 是规则预判（heading / volume / none），仅供参考，可以推翻。

只需判断类型，不要给出或改写标题（目录标题由程序从原文得出）。

例外：若某个 chapter 行同时表明开始了新的一卷，而前面没有对应的独立卷标题行（例如「《鬼吹灯之云南虫谷》 第一百章 人皮地图」，章名前的书名前缀与前面的章节不同），请在该 chapter 标签上给出 "volumeTitle"：卷名，必须原样摘自这一行（本例为「云南虫谷」），取书名 / 卷名部分，不是章名。卷名与当前卷相同、或前面已有该卷的独立卷标题行时不要给。

只返回一个 JSON 对象，不要任何额外说明：
{"labels":[{"id":0,"type":"chapter"},{"id":1,"type":"noise","noiseKind":"text"},{"id":2,"type":"chapter","volumeTitle":"云南虫谷"}],"notes":["需要提醒审核人的问题，可为空数组"]}
labels 必须覆盖下面列出的每一个 id，且每个 id 恰好出现一次（标为「上文」的候选行是上一批的重叠部分，仅供你参考上下文，也请一并标注）。`;

export const JUDGE_MIN_SPLIT = 50;
const MAX_LISTED_IDS = 5;

/** 本批无效时抛出，由调用方重试；message 是给人看的原因 */
class InvalidBatch extends Error {}

/** AI 调用本身失败（网络、超时、5xx 等）且同批重试用尽时抛出；message 是原始错误 */
class AiCallFailed extends Error {}

/** AI 调用临时出错时同一批的重试间隔（毫秒），最多重试这么多次；测试里可改成 0 */
export const judgeRetry = { delaysMs: [5000, 15000, 30000] };

/** 配置类错误（未配置 AI 插件），重试没有意义 */
const NO_RETRY_MESSAGES = ['未配置 AI 插件'];

/** fetch failed 的真正原因在 error.cause（如 UND_ERR_HEADERS_TIMEOUT、ECONNRESET），附在错误信息后；没有 cause 保持原样 */
function errorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const cause = e instanceof Error ? (e as { cause?: unknown }).cause : undefined;
  const reason = typeof cause === 'string' ? cause
    : cause && typeof cause === 'object' ? (cause as { code?: unknown; message?: unknown }).code || (cause as { message?: unknown }).message
    : undefined;
  return reason ? `${message}（原因：${reason}）` : message;
}

/**
 * 调一次 AI；网络错误等临时失败按 judgeRetry.delaysMs 的间隔在同一批内重试，不计入 InvalidBatch 的两次尝试。
 * 重试用尽抛 AiCallFailed；配置类错误直接抛出。
 */
async function chatWithRetry(prompt: string, db: Database.Database): Promise<string> {
  for (let retry = 0; ; retry++) {
    try {
      return await aiManager.chat(prompt, db);
    } catch (e) {
      const message = errorMessage(e);
      if (NO_RETRY_MESSAGES.includes(message)) throw e;
      if (retry >= judgeRetry.delaysMs.length) {
        throw new AiCallFailed(retry > 0 ? `重试 ${retry} 次后仍失败：${message}` : message);
      }
      console.warn(`[txt-organize] AI 调用失败，${judgeRetry.delaysMs[retry]}ms 后重试（第 ${retry + 1} 次）:`, message);
      await new Promise(r => setTimeout(r, judgeRetry.delaysMs[retry]));
    }
  }
}

function candidateLine(c: Candidate): string {
  return `#${c.id}\t${c.text}\tbodyChars=${c.bodyChars}\tbodyLines=${c.bodyLines}\tprev=${c.prevSnippet}\tnext=${c.nextSnippet}\thint=${c.ruleHint}`;
}

/** 上一批结束时的结构摘要：当前部 / 卷、最近几个章节的原文标题行。labels 与 candidates 下标对齐 */
function structureSummary(candidates: Candidate[], labels: Label[]): string {
  let part = '';
  let volume = '';
  const chapters: string[] = [];
  labels.forEach((l, i) => {
    const text = candidates[i].text.trim();
    if (l.type === 'part') { part = text; volume = ''; }
    else if (l.type === 'volume') volume = text;
    else if (l.type === 'chapter') {
      // AI 推断的新卷也算「当前卷」，让下一批知道卷名
      if (l.volumeTitle) volume = l.volumeTitle;
      chapters.push(text);
    }
  });
  if (!part && !volume && chapters.length === 0) return '（这是第一批，没有前文）';
  return `当前部：${part || '无'}\n当前卷：${volume || '无'}\n最近章节标题：${chapters.slice(-SUMMARY_CHAPTERS).join(' / ') || '无'}`;
}

function buildPrompt(
  book: { title: string; author?: string | null },
  summary: string,
  context: Candidate[],
  batch: Candidate[],
): string {
  const parts = [
    INSTRUCTIONS,
    `书名：${book.title}\n作者：${book.author || '未知'}`,
    `上一批结束时的结构摘要：\n${summary}`,
  ];
  if (context.length > 0) parts.push(`上文（重叠部分，仅供参考，也请标注）：\n${context.map(candidateLine).join('\n')}`);
  parts.push(`本批候选行：\n${batch.map(candidateLine).join('\n')}`);
  return parts.join('\n\n');
}

function listIds(ids: number[]): string {
  const shown = ids.slice(0, MAX_LISTED_IDS).join('、');
  return ids.length > MAX_LISTED_IDS ? `${shown} 等 ${ids.length} 个` : shown;
}

/**
 * 重叠部分用后一次的标签覆盖前一次；但后一次仍判为 chapter 却没给 volumeTitle 时保留前一次的 volumeTitle
 * （卷切换行落在重叠区时，后一批的摘要已是新卷，按提示词不会再报）。改判为其他类型则不保留。
 */
function overrideLabel(prev: Label | undefined, next: Label): Label {
  if (prev && prev.type === 'chapter' && prev.volumeTitle && next.type === 'chapter' && !next.volumeTitle) {
    return { ...next, volumeTitle: prev.volumeTitle };
  }
  return next;
}

/** 去掉所有空白，用于比较卷名是否摘自原行 */
function compact(s: string): string {
  return s.replace(/\s+/g, '');
}

interface ParsedBatch { labels: Label[]; notes: string[]; repaired: number }

/**
 * 解析一批 AI 输出。id 缺失 / 重复 / 多出、type 不在五种之内 → 整批无效；
 * noise 缺 noiseKind 则保守补全为 text（保留原文）；volumeTitle 只在 chapter 上、非空且是原行（去空白）连续子串时保留，chapter 上的非法值丢弃并计入补全，其他类型上的直接忽略。
 * AI 给的 title 等其他字段一律忽略（标题由 displayTitle 从原文得出）。
 */
function parseBatch(raw: string, expected: Candidate[]): ParsedBatch {
  const obj = extractJsonObject(raw);
  if (!obj || !Array.isArray(obj.labels)) throw new InvalidBatch('无法解析 JSON');
  const expectedIds = new Set(expected.map(c => c.id));
  const textById = new Map(expected.map(c => [c.id, c.text]));
  const byId = new Map<number, Label>();
  const duplicated: number[] = [];
  const extra: string[] = [];
  let repaired = 0;
  for (const item of obj.labels as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') throw new InvalidBatch('标签格式错误');
    const id = Number(item.id);
    if (!Number.isInteger(id) || !expectedIds.has(id)) { extra.push(String(item.id)); continue; }
    if (byId.has(id)) { duplicated.push(id); continue; }
    const type = item.type as LabelType;
    if (!LABEL_TYPES.includes(type)) throw new InvalidBatch(`id ${id} 的 type 无效：${item.type}`);
    const label: Label = { id, type };
    if (type === 'noise') {
      if (item.noiseKind === 'stray_number' || item.noiseKind === 'text') label.noiseKind = item.noiseKind;
      else { label.noiseKind = 'text'; repaired++; }
    }
    // 只看 chapter 上的 volumeTitle（其他类型上的直接忽略，不计入补全）；
    // null、空串视为没给；其他非字符串或不在原行中的值丢弃并计入补全
    const rawVolumeTitle = typeof item.volumeTitle === 'string' ? item.volumeTitle.trim() : item.volumeTitle;
    if (type === 'chapter' && rawVolumeTitle !== undefined && rawVolumeTitle !== null && rawVolumeTitle !== '') {
      if (typeof rawVolumeTitle === 'string' && compact(textById.get(id)!).includes(compact(rawVolumeTitle))) label.volumeTitle = rawVolumeTitle;
      else repaired++;
    }
    byId.set(id, label);
  }
  const missing = expected.filter(c => !byId.has(c.id)).map(c => c.id);
  if (missing.length > 0) throw new InvalidBatch(`缺少 id：${listIds(missing)}`);
  if (duplicated.length > 0) throw new InvalidBatch(`id 重复：${listIds(duplicated)}`);
  if (extra.length > 0) {
    const shown = extra.slice(0, MAX_LISTED_IDS).join('、');
    throw new InvalidBatch(`多出 id：${extra.length > MAX_LISTED_IDS ? `${shown} 等 ${extra.length} 个` : shown}`);
  }
  const notes = Array.isArray(obj.notes) ? (obj.notes as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
  return { labels: expected.map(c => byId.get(c.id)!), notes, repaired };
}

/**
 * 判定一批（或拆出的半批）：最多两次；两次都无效则对半拆分，两半各自沿用同样的上文和结构摘要递归判定，
 * 新候选行少于 2 × JUDGE_MIN_SPLIT 时不再拆分，抛出最后一次的 InvalidBatch。
 * 网络等 AI 调用错误在 chatWithRetry 里同批重试，用尽后抛 AiCallFailed（不触发拆分）。
 */
async function judgeBatch(
  book: { title: string; author?: string | null },
  summary: string,
  context: Candidate[],
  batch: Candidate[],
  db: Database.Database,
): Promise<ParsedBatch> {
  const prompt = buildPrompt(book, summary, context, batch);
  let lastError: InvalidBatch | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return parseBatch(await chatWithRetry(prompt, db), [...context, ...batch]);
    } catch (e) {
      if (!(e instanceof InvalidBatch)) throw e;
      lastError = e;
    }
  }
  if (batch.length < JUDGE_MIN_SPLIT * 2) throw lastError!;
  const mid = Math.ceil(batch.length / 2);
  const first = await judgeBatch(book, summary, context, batch.slice(0, mid), db);
  const second = await judgeBatch(book, summary, context, batch.slice(mid), db);
  // 上文部分以后一半为准（与「重叠部分以后一批为准」一致）
  const byId = new Map<number, Label>();
  for (const l of [...first.labels, ...second.labels]) byId.set(l.id, overrideLabel(byId.get(l.id), l));
  return {
    labels: [...context, ...batch].map(c => byId.get(c.id)!),
    notes: [...first.notes, ...second.notes],
    repaired: first.repaired + second.repaired,
  };
}

export async function judgeCandidates(
  candidates: Candidate[],
  book: { title: string; author?: string | null },
  db: Database.Database,
  onBatch?: (done: number, total: number) => void,
): Promise<JudgeResult> {
  const total = Math.ceil(candidates.length / JUDGE_BATCH_SIZE);
  // 按候选序号存放；重叠部分后一批覆盖前一批
  const labels: Label[] = new Array(candidates.length);
  const notes: string[] = [];

  for (let b = 0; b < total; b++) {
    const start = b * JUDGE_BATCH_SIZE;
    const batch = candidates.slice(start, start + JUDGE_BATCH_SIZE);
    const context = candidates.slice(Math.max(0, start - JUDGE_OVERLAP), start);
    let parsed: ParsedBatch;
    try {
      parsed = await judgeBatch(book, structureSummary(candidates, labels.slice(0, start)), context, batch, db);
    } catch (e) {
      if (e instanceof InvalidBatch) throw new Error(`AI 判定失败：第 ${b + 1} 批（${e.message}）`);
      if (e instanceof AiCallFailed) throw new Error(`AI 调用失败：第 ${b + 1} 批（${e.message}）`);
      throw e;
    }

    // 候选 id 即其在数组中的位置
    parsed.labels.forEach(l => { labels[l.id] = overrideLabel(labels[l.id], l); });
    notes.push(...parsed.notes);
    if (parsed.repaired > 0) notes.push(`第 ${b + 1} 批有 ${parsed.repaired} 条标签格式不全，已按保守方式处理`);
    onBatch?.(b + 1, total);
  }

  if (!labels.some(l => l.type === 'chapter')) throw new Error('AI 判定失败：没有识别出任何 chapter 章节');
  const firstReal = labels.find(l => l.type !== 'noise');
  if (firstReal && firstReal.type === 'duplicate') throw new Error('AI 判定失败：第一个有效标签不能是 duplicate');
  return { labels, notes, batches: total };
}
