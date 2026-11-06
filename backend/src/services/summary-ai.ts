import { cleanAiText } from './ai-reading';
import type { ThemeBlock } from './summary-doc';

export interface StudyNote {
  ref: string;
  kind: 'highlight' | 'concept' | 'event' | 'person' | 'custom';
  chapterIndex: number;
  text: string;
  summary?: string;
  note?: string;
  parentLabel?: string;
}

export class SummaryAiOutputError extends Error {
  constructor(message = 'AI 返回格式不正确') {
    super(message);
    this.name = 'SummaryAiOutputError';
  }
}

const NOTE_MAX_CHARS = 1000;
const KIND_LABEL: Record<StudyNote['kind'], string> = {
  highlight: '划线', concept: '概念', event: '事件', person: '人物', custom: '自定义',
};

function clip(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n).join('') + '…' : s;
}

function serializeNote(n: StudyNote): string {
  const parts = [`[[${n.ref}]] 第${n.chapterIndex + 1}章 ${KIND_LABEL[n.kind]}：${n.text}`];
  if (n.summary) parts.push(`说明：${n.summary}`);
  if (n.parentLabel) parts.push(`所属：${n.parentLabel}`);
  if (n.note) parts.push(`批注：${n.note}`);
  return parts.join('；');
}

function limitNote(n: StudyNote): StudyNote {
  if (serializeNote(n).length <= NOTE_MAX_CHARS) return n;
  return {
    ...n,
    text: clip(n.text, 600),
    summary: n.summary === undefined ? undefined : clip(n.summary, 100),
    note: n.note === undefined ? undefined : clip(n.note, 300),
  };
}

export function splitBatches(
  notes: StudyNote[],
  opts: { maxNotes?: number; maxChars?: number } = {},
): StudyNote[][] {
  const maxNotes = opts.maxNotes ?? 60;
  const maxChars = opts.maxChars ?? 12000;
  const batches: StudyNote[][] = [];
  let cur: StudyNote[] = [];
  let chars = 0;
  for (const raw of notes) {
    const n = limitNote(raw);
    const len = serializeNote(n).length;
    if (cur.length > 0 && (cur.length >= maxNotes || chars + len > maxChars)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(n);
    chars += len;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

function noteLines(notes: StudyNote[]): string {
  return [...notes]
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map(serializeNote)
    .join('\n');
}

const OUTPUT_RULES = `输出格式：只输出 JSON，不要任何解释或 Markdown 围栏，结构为：
{"themes":[{"title":"主题名","paragraphs":["段落文字 [[h:xxx]] 段落文字 [[n:yyy]]"]}]}
要求：
1. 使用中文。
2. 按主题归纳，把相关笔记串起来写成连贯的段落，不要逐条罗列。
3. 每个论点用 [[标识]] 标注依据，标识必须原样取自笔记前的 [[…]]，可在一个段落中使用多个。
4. 不得编造笔记中没有的内容。`;

export function buildGeneratePrompt(bookTitle: string, notes: StudyNote[]): string {
  return `你是一名学习助手。下面是读者阅读《${bookTitle}》时留下的划线、批注和知识点，请据此写一篇学习总结。

${OUTPUT_RULES}

笔记（按章节顺序）：
${noteLines(notes)}`;
}

export function buildUpdatePrompt(bookTitle: string, themes: string[], notes: StudyNote[]): string {
  const themeList = themes.length ? themes.map(t => `- ${t}`).join('\n') : '（暂无）';
  return `你是一名学习助手。读者阅读《${bookTitle}》的学习总结已有如下主题：
${themeList}

下面是新增的笔记。请只为这些新笔记写补充内容，优先放入已有主题（title 与已有主题名完全一致）；确实无法归入时再新建主题。已有内容不要改写，也不要重复已有主题中已经写过的内容。

${OUTPUT_RULES}

新增笔记（按章节顺序）：
${noteLines(notes)}`;
}

const REF_RE = /\[\[([^\[\]]+)\]\]/g;

function splitParagraph(s: string, validRefs: Set<string>): ThemeBlock['paragraphs'][number] {
  const parts: ThemeBlock['paragraphs'][number] = [];
  let last = 0;
  const pushText = (t: string) => { if (t) parts.push({ text: t }); };
  for (const m of s.matchAll(REF_RE)) {
    const idx = m.index as number;
    pushText(s.slice(last, idx));
    const ref = m[1].trim();
    if (validRefs.has(ref)) parts.push({ ref });
    last = idx + m[0].length;
  }
  pushText(s.slice(last));
  return parts;
}

export function parseThemes(raw: string, validRefs: Set<string>): ThemeBlock[] {
  const text = cleanAiText(String(raw)).replace(/```[a-z]*\s*/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new SummaryAiOutputError();
  let data: unknown;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new SummaryAiOutputError();
  }
  const themes = data && typeof data === 'object' ? (data as Record<string, unknown>).themes : null;
  if (!Array.isArray(themes)) throw new SummaryAiOutputError();

  const result: ThemeBlock[] = [];
  for (const item of themes) {
    if (!item || typeof item !== 'object') continue;
    const { title, paragraphs } = item as Record<string, unknown>;
    if (typeof title !== 'string' || !title.trim() || !Array.isArray(paragraphs)) continue;
    const blocks: ThemeBlock['paragraphs'] = [];
    for (const p of paragraphs) {
      if (typeof p !== 'string') continue;
      const parts = splitParagraph(p, validRefs);
      // 只剩空白文字或无内容的段落丢弃
      if (parts.some(x => ('ref' in x) || x.text.trim())) blocks.push(parts);
    }
    if (blocks.length) result.push({ theme: title.trim(), paragraphs: blocks });
  }
  if (result.length === 0) throw new SummaryAiOutputError();
  return result;
}
