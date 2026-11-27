import Database from 'better-sqlite3';
import { aiManager } from '../../ai/ai-manager';
import { extractJsonObject } from '../../ai/json-extract';
import { stripTitlePromo } from '../../plugins/parser-txt';
import { Candidate } from './candidates';

export type LabelType = 'part' | 'volume' | 'chapter' | 'duplicate' | 'noise';

export interface Label {
  id: number;
  type: LabelType;
  /** part / volume / chapter 必有 */
  title?: string;
  /** noise 必有 */
  noiseKind?: 'stray_number' | 'text';
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
- volume：「卷」级标题，例如「第一卷 xxx」；同一行同时带部和卷的（如「第一部第一卷《精绝古城》」）标为 volume，title 里保留部名前缀以外的卷名，不要拆成两行。
- chapter：真正的章节标题（「第12章 xxx」「楔子」「番外」等），后面通常跟着一段正常篇幅的正文。
- duplicate：同一个标题被重复写了第二遍。例：「第5章 怎么像找对象？」后面紧接「第0005章怎么像找对象？？」，后一行是 duplicate（前一行才是 chapter）。
- noise：不是标题的行，必须再给 noiseKind：
  - stray_number：正文里夹杂的另一套编号，整行只有「第N章」之类、没有章名，且编号不大于前面已出现的有名章节编号。例：已有「第二章 青牛镇」后又出现孤零零的「第2章」。
  - text：恰好以「第」「《」等开头、但其实是正文句子或说明的行。例：「第二卷《山水郎》结束。」「第三回合他输了……」；以「第…回」开头的句子也是 text。

判断时请充分利用每行给出的 bodyChars / bodyLines（到下一候选行之间的正文字数 / 行数）和 prev / next 前后文片段：真正的章节后面通常有几百字以上的正文，正文极短或为 0 的候选行更可能是 noise 或 duplicate；ruleHint 是规则预判（heading / volume / none），仅供参考，可以推翻。

title 规则：part / volume / chapter 必须给出 title。title 只去掉附言、水印和多余前缀，例如行尾的【求月票】【求推荐票】等推广语、与章名无关的卷名前缀；不要改写章名、不要转换数字（「第十二章」保持「第十二章」，「第0005章」保持原样）。

只返回一个 JSON 对象，不要任何额外说明：
{"labels":[{"id":0,"type":"chapter","title":"第1章 xxx"},{"id":1,"type":"noise","noiseKind":"text"}],"notes":["需要提醒审核人的问题，可为空数组"]}
labels 必须覆盖下面列出的每一个 id，且每个 id 恰好出现一次（标为「上文」的候选行是上一批的重叠部分，仅供你参考上下文，也请一并标注）。`;

export const JUDGE_MIN_SPLIT = 50;
const MAX_LISTED_IDS = 5;

/** 本批无效时抛出，由调用方重试；message 是给人看的原因 */
class InvalidBatch extends Error {}

function candidateLine(c: Candidate): string {
  return `#${c.id}\t${c.text}\tbodyChars=${c.bodyChars}\tbodyLines=${c.bodyLines}\tprev=${c.prevSnippet}\tnext=${c.nextSnippet}\thint=${c.ruleHint}`;
}

/** 上一批结束时的结构摘要：当前部名 / 卷名、最近几个章节标题 */
function structureSummary(labels: Label[]): string {
  let part = '';
  let volume = '';
  const chapters: string[] = [];
  for (const l of labels) {
    if (l.type === 'part') { part = l.title ?? ''; volume = ''; }
    else if (l.type === 'volume') volume = l.title ?? '';
    else if (l.type === 'chapter') chapters.push(l.title ?? '');
  }
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

const DIGIT_RUN_RE = /[零〇一二两三四五六七八九十百千万\d０-９]+/g;
/** 「第N章 / 卷…」编号（在去掉空白的文本上匹配，所以第 / N / 单位之间的空白已容忍） */
const NUMBERED_RE = /第[零〇一二两三四五六七八九十百千万\d０-９]+[章节回集卷部]/g;

/**
 * title 能否由原文只删字得到：去掉空白后 title 是 text 的子序列，
 * 且 title 里每一段连续的数字（中文 / 阿拉伯 / 全角）都是原文里完整的一段数字——
 * 否则「第五卷…第六百五十九章」能凑出「第五百五十九章」（五取自卷号），「第１２章」删字成「第１章」也会被放过；
 * 并且 title 里每个「第N章 / 卷…」都以相同编号和单位出现在原文中——否则卷号能挪作章号（「第五卷…」→「第五章…」）
 */
function isDeletionOf(title: string, text: string): boolean {
  const t = Array.from(title.replace(/\s+/g, ''));
  const s = text.replace(/\s+/g, '');
  let i = 0;
  for (const c of s) if (i < t.length && c === t[i]) i++;
  if (i < t.length) return false;
  const runs = new Set(s.match(DIGIT_RUN_RE) ?? []);
  const compactTitle = t.join('');
  if (!(compactTitle.match(DIGIT_RUN_RE) ?? []).every(n => runs.has(n))) return false;
  const numbered = new Set(s.match(NUMBERED_RE) ?? []);
  return (compactTitle.match(NUMBERED_RE) ?? []).every(n => numbered.has(n));
}

interface ParsedBatch { labels: Label[]; notes: string[]; repaired: number; rewritten: number }

/**
 * 解析一批 AI 输出。id 缺失 / 重复 / 多出、type 不在五种之内 → 整批无效；
 * 单条标签字段不全则保守补全：noise 缺 noiseKind 当 text（保留原文），part / volume / chapter 缺 title 用候选行原文。
 * AI 只能删减原文得到标题（去附言、去前缀）；改动了原文（如把「六百」改成「五百」）的标题改回原文（去掉行尾附言）。
 */
function parseBatch(raw: string, expected: Candidate[]): ParsedBatch {
  const obj = extractJsonObject(raw);
  if (!obj || !Array.isArray(obj.labels)) throw new InvalidBatch('无法解析 JSON');
  const textById = new Map(expected.map(c => [c.id, c.text]));
  const byId = new Map<number, Label>();
  const duplicated: number[] = [];
  const extra: string[] = [];
  let repaired = 0;
  let rewritten = 0;
  for (const item of obj.labels as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') throw new InvalidBatch('标签格式错误');
    const id = Number(item.id);
    if (!Number.isInteger(id) || !textById.has(id)) { extra.push(String(item.id)); continue; }
    if (byId.has(id)) { duplicated.push(id); continue; }
    const type = item.type as LabelType;
    if (!LABEL_TYPES.includes(type)) throw new InvalidBatch(`id ${id} 的 type 无效：${item.type}`);
    const label: Label = { id, type };
    if (type === 'part' || type === 'volume' || type === 'chapter') {
      const text = textById.get(id)!;
      if (typeof item.title !== 'string' || !item.title.trim()) { label.title = text.trim(); repaired++; }
      else if (isDeletionOf(item.title, text)) label.title = item.title.trim();
      else { label.title = stripTitlePromo(text.trim()); rewritten++; }
    } else if (type === 'noise') {
      if (item.noiseKind === 'stray_number' || item.noiseKind === 'text') label.noiseKind = item.noiseKind;
      else { label.noiseKind = 'text'; repaired++; }
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
  return { labels: expected.map(c => byId.get(c.id)!), notes, repaired, rewritten };
}

/**
 * 判定一批（或拆出的半批）：最多两次；两次都无效则对半拆分，两半各自沿用同样的上文和结构摘要递归判定，
 * 新候选行少于 2 × JUDGE_MIN_SPLIT 时不再拆分，抛出最后一次的 InvalidBatch。网络等 AI 调用错误直接抛出。
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
      return parseBatch(await aiManager.chat(prompt, db), [...context, ...batch]);
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
  for (const l of [...first.labels, ...second.labels]) byId.set(l.id, l);
  return {
    labels: [...context, ...batch].map(c => byId.get(c.id)!),
    notes: [...first.notes, ...second.notes],
    repaired: first.repaired + second.repaired,
    rewritten: first.rewritten + second.rewritten,
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
      parsed = await judgeBatch(book, structureSummary(labels.slice(0, start)), context, batch, db);
    } catch (e) {
      if (e instanceof InvalidBatch) throw new Error(`AI 判定失败：第 ${b + 1} 批（${e.message}）`);
      throw e;
    }

    // 候选 id 即其在数组中的位置
    parsed.labels.forEach(l => { labels[l.id] = l; });
    notes.push(...parsed.notes);
    if (parsed.repaired > 0) notes.push(`第 ${b + 1} 批有 ${parsed.repaired} 条标签格式不全，已按保守方式处理`);
    if (parsed.rewritten > 0) notes.push(`第 ${b + 1} 批有 ${parsed.rewritten} 个标题被 AI 改动了原文，已改回原标题`);
    onBatch?.(b + 1, total);
  }

  if (!labels.some(l => l.type === 'chapter')) throw new Error('AI 判定失败：没有识别出任何 chapter 章节');
  const firstReal = labels.find(l => l.type !== 'noise');
  if (firstReal && firstReal.type === 'duplicate') throw new Error('AI 判定失败：第一个有效标签不能是 duplicate');
  return { labels, notes, batches: total };
}
