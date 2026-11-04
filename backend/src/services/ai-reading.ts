// 阅读器 AI 功能（前情提要 / 问书）的纯函数：正文整理、本地关键词检索、提示词构建。
// 设计见 docs/superpowers/specs/2026-11-04-ai-recap-ask-design.md

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** 章节 HTML（或纯文本）→ 段落纯文本列表 */
export function chapterParagraphs(html: string): string[] {
  const text = html.includes('<')
    ? decodeEntities(
      html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr)>/gi, '\n')
        .replace(/<[^>]*>/g, ''),
    )
    : html;
  return text.split('\n').map(s => s.replace(/^[\s　]+|[\s　]+$/g, '')).filter(Boolean);
}

/** 当前章已读部分：从开头到阅读位置所在段落（含） */
export function readPart(html: string, paragraphIndex: number): string {
  return chapterParagraphs(html).slice(0, Math.max(0, paragraphIndex) + 1).join('\n');
}

/** 过长文本保留开头与结尾（结尾更接近读者刚读过的情节，占比更大） */
export function clipMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}……${text.slice(text.length - (max - head))}`;
}

// 词首 / 词尾不应出现的虚字：避免「梅丽莎是」「问一下」这类带尾巴的词盖过真正的名字
const EDGE_CHARS = new Set('是的了和与在吗呢啊吧谁么过把被给对跟有就都也又还很再才这那他她它我你什怎为哪几多'.split(''));
const STOP_TERMS = new Set([
  '什么', '为什么', '怎么', '怎样', '如何', '哪里', '哪个', '哪些', '之前', '以前', '后来', '现在', '目前',
  '发生', '事情', '这个', '那个', '有没有', '是不是', '一下', '关系', '介绍', '主角', '他们', '她们', '我们',
  '为何', '是否', '情节', '剧情', '章节', '本章', '上一章', '这一章', '内容',
]);

/**
 * 从问题里提取用于检索的词：中文取 2–6 字的片段、英文取单词，
 * 只保留在已读正文里出现过的，长词优先，已被更长词覆盖的短词不再重复。
 */
export function extractQueryTerms(question: string, corpus: string, limit = 6): string[] {
  const candidates = new Set<string>();
  for (const run of question.match(/[一-鿿]+/g) || []) {
    for (let len = Math.min(6, run.length); len >= 2; len--) {
      for (let i = 0; i + len <= run.length; i++) {
        const t = run.slice(i, i + len);
        if (EDGE_CHARS.has(t[0]) || EDGE_CHARS.has(t[t.length - 1]) || STOP_TERMS.has(t)) continue;
        candidates.add(t);
      }
    }
  }
  const lowerCorpus = corpus.toLowerCase();
  for (const w of question.match(/[A-Za-z0-9]{2,}/g) || []) candidates.add(w.toLowerCase());

  const found = [...candidates]
    .filter(t => lowerCorpus.includes(t.toLowerCase()))
    .sort((a, b) => b.length - a.length || question.indexOf(a) - question.indexOf(b));
  const kept: string[] = [];
  for (const t of found) {
    if (kept.some(k => k.includes(t))) continue;
    kept.push(t);
    if (kept.length >= limit) break;
  }
  return kept;
}

export interface ChapterText { index: number; title: string; text: string }
export interface Snippet { chapterIndex: number; title: string; text: string }

/**
 * 本地检索：每个词首次出现的章节（人物 / 事物的来历）优先，其次按命中次数 × 词长打分；
 * 截取命中处前后片段，总字数不超过 maxChars，结果按章节顺序排列。
 */
export function findRelevantSnippets(
  terms: string[],
  chapters: ChapterText[],
  { window = 150, maxChars = 6000, maxChapters = 6, perChapter = 3 }: { window?: number; maxChars?: number; maxChapters?: number; perChapter?: number } = {},
): Snippet[] {
  if (terms.length === 0) return [];
  const scored = chapters.map(ch => {
    let score = 0;
    for (const t of terms) score += (ch.text.split(t).length - 1) * t.length;
    return { ch, score };
  }).filter(x => x.score > 0);
  if (scored.length === 0) return [];

  const order: ChapterText[] = [];
  const add = (ch: ChapterText) => { if (!order.includes(ch) && order.length < maxChapters) order.push(ch); };
  for (const t of terms) {
    const first = scored.find(x => x.ch.text.includes(t));
    if (first) add(first.ch);
  }
  [...scored].sort((a, b) => b.score - a.score).forEach(x => add(x.ch));

  const out: Snippet[] = [];
  let budget = maxChars;
  for (const ch of order) {
    if (budget < 20) break;
    const ranges: Array<[number, number]> = [];
    for (const t of terms) {
      let pos = ch.text.indexOf(t);
      while (pos >= 0 && ranges.length < perChapter * terms.length) {
        ranges.push([Math.max(0, pos - window), Math.min(ch.text.length, pos + t.length + window)]);
        pos = ch.text.indexOf(t, pos + t.length);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    let text = merged.slice(0, perChapter).map(([a, b]) => ch.text.slice(a, b)).join('……');
    if (text.length > budget) text = text.slice(0, budget);
    budget -= text.length;
    out.push({ chapterIndex: ch.index, title: ch.title, text });
  }
  return out.sort((a, b) => a.chapterIndex - b.chapterIndex);
}

export function buildRecapPrompt(bookTitle: string, chapters: Array<{ title: string; text: string }>): string {
  const body = chapters.map(c => `### ${c.title}\n${c.text}`).join('\n\n');
  return [
    `你是小说阅读助手。读者隔了一段时间重新打开《${bookTitle}》，请根据下面读者已经读过的内容，用简体中文写一段「前情提要」，帮读者快速回忆：`,
    '- 150~250 字，按时间顺序概括主要情节，点出关键人物（首次提到时简单说明身份）和尚未解决的悬念；',
    '- 只依据提供的内容，不要编造，也不要推测或透露后续情节；',
    '- 直接输出提要正文，不要标题、不要列表符号。',
    '',
    '【已读内容】',
    body,
  ].join('\n');
}

export function buildAskPrompt(input: {
  bookTitle: string;
  question: string;
  snippets: Snippet[];
  current: { title: string; text: string };
  history: Array<{ q: string; a: string }>;
}): string {
  const { bookTitle, question, snippets, current, history } = input;
  const parts = [
    `你是小说阅读助手，读者正在读《${bookTitle}》，目前读到「${current.title}」。请只根据下面提供的已读内容回答读者的问题：`,
    '- 用简体中文，简洁直接，一般不超过 200 字；',
    '- 提供的内容里找不到答案时，直接说明「已读内容中没有提到」，不要编造；',
    '- 不要透露或猜测读者当前位置之后的情节。',
  ];
  if (snippets.length > 0) {
    parts.push('', '【相关片段（来自已读章节）】');
    for (const s of snippets) parts.push(`[${s.title}] ${s.text}`);
  }
  parts.push('', `【当前章节「${current.title}」已读部分】`, current.text || '（无）');
  if (history.length > 0) {
    parts.push('', '【之前的对话】');
    for (const h of history) parts.push(`问：${h.q}`, `答：${h.a}`);
  }
  parts.push('', '【读者的问题】', question);
  return parts.join('\n');
}

/** 去掉推理模型输出里的思考内容 */
export function cleanAiText(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
}
