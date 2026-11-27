import Database from 'better-sqlite3';
import { aiManager } from '../../ai/ai-manager';
import { extractJsonObject } from '../../ai/json-extract';
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

/** 本批无效时抛出，由调用方重试 */
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

function parseBatch(raw: string, expectedIds: number[]): { labels: Label[]; notes: string[] } {
  const obj = extractJsonObject(raw);
  if (!obj || !Array.isArray(obj.labels)) throw new InvalidBatch('无法解析 JSON');
  const byId = new Map<number, Label>();
  for (const item of obj.labels as Record<string, unknown>[]) {
    if (!item || typeof item !== 'object') throw new InvalidBatch('标签格式错误');
    const id = Number(item.id);
    if (!Number.isInteger(id) || byId.has(id)) throw new InvalidBatch(`id 非法或重复：${item.id}`);
    const type = item.type as LabelType;
    if (!LABEL_TYPES.includes(type)) throw new InvalidBatch(`type 非法：${item.type}`);
    const label: Label = { id, type };
    if (type === 'part' || type === 'volume' || type === 'chapter') {
      if (typeof item.title !== 'string' || !item.title.trim()) throw new InvalidBatch(`缺少 title：${id}`);
      label.title = item.title.trim();
    } else if (type === 'noise') {
      if (item.noiseKind !== 'stray_number' && item.noiseKind !== 'text') throw new InvalidBatch(`缺少 noiseKind：${id}`);
      label.noiseKind = item.noiseKind;
    }
    byId.set(id, label);
  }
  if (byId.size !== expectedIds.length || expectedIds.some(id => !byId.has(id))) throw new InvalidBatch('id 与本批不一致');
  const notes = Array.isArray(obj.notes) ? (obj.notes as unknown[]).filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
  return { labels: expectedIds.map(id => byId.get(id)!), notes };
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
    const expectedIds = [...context, ...batch].map(c => c.id);
    const prompt = buildPrompt(book, structureSummary(labels.slice(0, start)), context, batch);

    let parsed: { labels: Label[]; notes: string[] } | undefined;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try {
        parsed = parseBatch(await aiManager.chat(prompt, db), expectedIds);
      } catch (e) {
        if (!(e instanceof InvalidBatch)) throw e;
      }
    }
    if (!parsed) throw new Error(`AI 判定失败：第 ${b + 1} 批`);

    // labels 与 expectedIds 同序；候选 id 即其在数组中的位置
    parsed.labels.forEach(l => { labels[l.id] = l; });
    notes.push(...parsed.notes);
    onBatch?.(b + 1, total);
  }

  if (!labels.some(l => l.type === 'chapter')) throw new Error('AI 判定失败：没有识别出任何 chapter 章节');
  const firstReal = labels.find(l => l.type !== 'noise');
  if (firstReal && firstReal.type === 'duplicate') throw new Error('AI 判定失败：第一个有效标签不能是 duplicate');
  return { labels, notes, batches: total };
}
