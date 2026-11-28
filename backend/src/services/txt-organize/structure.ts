import { chapterNumberValue, stripTitlePromo } from '../../plugins/parser-txt';
import { Candidate } from './candidates';
import { Label } from './judge';
import { readTxtLines } from './lines';

export interface OrgSection {
  level: 0 | 1 | 2;
  title: string;
  /** 没有正文的部 / 卷：只作目录分组 */
  groupOnly: boolean;
  /** 原文字节区间，含标题行；到下一个部 / 卷 / 章标题行开头为止，最后一个到文件末尾 */
  srcStart: number;
  srcEnd: number;
}

export interface OrgStructure {
  sections: OrgSection[];
  /** 要从正文去掉的 lineNo：标题行、duplicate、合格的 stray_number */
  dropLines: Set<number>;
  /** 第一个标题之前的内容 */
  preface: { srcStart: number; srcEnd: number } | null;
  /** 需要提醒审核人的问题（如被判为 duplicate 但与上一标题不一致、已保留为正文的行） */
  notes: string[];
}

const STRAY_NUMBER_RE = /^第[零〇一二两三四五六七八九十百千万\d]+[章节回集]$/;

/** 去掉空白后整行只有「第 N 章 / 节 / 回 / 集」 */
export function isStrictStrayNumber(text: string): boolean {
  return STRAY_NUMBER_RE.test(text.replace(/\s+/g, ''));
}

const isStructural = (l: Label) => l.type === 'part' || l.type === 'volume' || l.type === 'chapter';

const NUM_RE = /第([零〇一二两三四五六七八九十百千万\d]+)([章节回集卷部])/g;

/** 标题行的编号（最后一个「第N章/节/回/集」，没有时取最后一个「第N卷/部」）和去掉编号后的名称 */
function headingParts(text: string): { unit: 'chapter' | 'volume' | null; num: number; name: string } {
  const s = stripTitlePromo(text.trim())
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '');
  const matches = [...s.matchAll(NUM_RE)];
  const chapterMatches = matches.filter(m => '章节回集'.includes(m[2]));
  const picked = chapterMatches.length ? chapterMatches[chapterMatches.length - 1] : matches[matches.length - 1];
  // 名称：最后一个编号之后的部分，去掉标点和符号
  const tail = matches.length ? s.slice(matches[matches.length - 1].index! + matches[matches.length - 1][0].length) : s;
  const name = tail.replace(/[\p{P}\p{S}]/gu, '');
  if (!picked) return { unit: null, num: NaN, name };
  return { unit: chapterMatches.length ? 'chapter' : 'volume', num: chapterNumberValue(picked[1]), name };
}

const namesMatch = (a: string, b: string) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

/** duplicate 行是否确实是上一标题的重复：编号同类时数值必须相等（且名称为空或一致）；否则名称必须一致 */
export function isDuplicateOf(dupText: string, headingText: string): boolean {
  const d = headingParts(dupText);
  const h = headingParts(headingText);
  if (d.unit && d.unit === h.unit) {
    if (Number.isNaN(d.num) || d.num !== h.num) return false;
    return d.name === '' || namesMatch(d.name, h.name);
  }
  return namesMatch(d.name, h.name);
}

const NUM_CHARS = '[零〇一二两三四五六七八九十百千万\\d０-９]+';
/** 行首「第X部」（「第一部分」不算） */
const PART_PREFIX_RE = new RegExp(`^第\\s*(${NUM_CHARS})\\s*部(?!分)`);
/** 行首（可带「第X部」）「第Y卷<卷名>」，后面紧跟「第Z章/节/回/集」 */
const VOLUME_PREFIX_RE = new RegExp(`^(?:第\\s*${NUM_CHARS}\\s*部(?!分)\\s*)?(第\\s*(${NUM_CHARS})\\s*卷.*?)\\s*第\\s*${NUM_CHARS}\\s*[章节回集]`);
/** 行首（可带「第X部」）「第Y卷」 */
const VOLUME_START_RE = new RegExp(`^(?:第\\s*${NUM_CHARS}\\s*部(?!分)\\s*)?第\\s*(${NUM_CHARS})\\s*卷`);

const numValue = (s: string) =>
  chapterNumberValue(s.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)));

/** 行首「正文」及其后的空白 / 冒号 */
const BODY_PREFIX_RE = /^正文[\s:：]*/;
/** 行首《书名》前缀（后面紧跟「第N章 / 节 / 回 / 集 / 卷 / 部」或阿拉伯 / 全角数字） */
const BOOK_NAME_PREFIX_RE = new RegExp(`^《[^》]*》\\s*(?=第\\s*${NUM_CHARS}\\s*[章节回集卷部]|[\\d０-９])`);
/** 「第Y卷」开头（用来从卷前缀里取出卷名） */
const VOLUME_NUM_RE = new RegExp(`^第\\s*${NUM_CHARS}\\s*卷`);

/** 卷名比较用：去掉标点、符号和空白 */
const volumeNameKey = (s: string) => s.replace(/[\p{P}\p{S}\s]/gu, '');

/**
 * 目录里显示的标题：一律由原文按固定规则得出（AI 只判断类型，章卷编号不会被改动）。
 * 原文去掉首尾空白和行尾附言后，依次去掉行首「正文」、后面紧跟编号的《书名》、所在部的「第X部」前缀、所在卷的「第Y卷<卷名>」前缀；
 * 其余一字不动，去完为空时返回原文
 */
export function displayTitle(originalText: string, context: { volumePrefix?: string; partPrefix?: string }): string {
  const original = originalText.trim();
  let s = stripTitlePromo(original).replace(BODY_PREFIX_RE, '').replace(BOOK_NAME_PREFIX_RE, '');
  for (const prefix of [context.partPrefix, context.volumePrefix]) {
    if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length).trim();
  }
  return s || original;
}

interface GroupEntry {
  type: 'part' | 'volume' | 'chapter';
  title: string;
  /** 对应（推断出的部 / 卷：触发它的）候选行下标 */
  idx: number;
  synthetic: boolean;
}

/**
 * 按原文标题行的「第X部」「第Y卷<卷名>」前缀补出 AI 没标出的部 / 卷（编号只增不减），
 * 按 AI 在章节标签上指出的 volumeTitle 补出新卷（与当前卷名相同或互相包含时不建；当前卷有编号无卷名且还没有章时只补卷名），
 * 并去掉与当前卷编号相同、或一侧编号未知时卷名与当前卷名一致的单独分卷标题行（重复的卷标题，标题行已在 dropLines 里）。
 * 返回按顺序排列的部 / 卷 / 章（含推断出的部 / 卷），标题由 displayTitle 从原文得出
 */
function inferGroups(candidates: Candidate[], labels: Label[], dropLines: Set<number>, notes: string[]): GroupEntry[] {
  const entries: GroupEntry[] = [];
  let curPart: number | null = null;
  let curVolume: number | null = null;
  // 当前卷名（去掉标点），用来按名称合并同一卷；进入新部时清空
  let curVolumeName = '';
  // 按 volumeTitle 建出的卷名
  const aiVolumes: string[] = [];
  let partCount = 0;
  let volumeCount = 0;
  const greater = (n: number, cur: number | null) => !Number.isNaN(n) && (cur === null || n > cur);
  candidates.forEach((c, i) => {
    const l = labels[i];
    if (!isStructural(l)) return;
    const text = c.text.trim();
    if (l.type === 'part') {
      const m = text.match(PART_PREFIX_RE);
      const n = m ? numValue(m[1]) : NaN;
      if (!Number.isNaN(n)) curPart = n;
      curVolume = null;
      curVolumeName = '';
      entries.push({ type: 'part', title: displayTitle(text, {}), idx: i, synthetic: false });
      return;
    }
    const pm = text.match(PART_PREFIX_RE);
    if (pm && greater(numValue(pm[1]), curPart)) {
      curPart = numValue(pm[1]);
      curVolume = null;
      curVolumeName = '';
      partCount++;
      entries.push({ type: 'part', title: pm[0], idx: i, synthetic: true });
    }
    // 在所在部下：去掉「第X部」前缀
    const partPrefix = pm && numValue(pm[1]) === curPart ? pm[0] : undefined;
    // 章标题前的卷名前缀（AI 标成卷但后面还带章号的行，也按章处理）
    const vm = text.match(VOLUME_PREFIX_RE);
    if (vm) {
      const n = numValue(vm[2]);
      const name = volumeNameKey(vm[1].replace(VOLUME_NUM_RE, ''));
      if (curVolume === null && namesMatch(name, curVolumeName)) {
        // 当前卷没有编号（如先按 volumeTitle 建了卷）且卷名一致：同一卷，只补上编号。
        // 当前卷有编号时只看编号，避免编号不同的两卷因卷名互相包含被合并
        curVolume = n;
      } else if (greater(n, curVolume)) {
        curVolume = n;
        curVolumeName = name;
        volumeCount++;
        entries.push({ type: 'volume', title: vm[1].trim(), idx: i, synthetic: true });
      }
      // 在所在卷下：去掉卷名前缀；乱入的旧卷前缀保留
      const volumePrefix = n === curVolume ? vm[1].trim() : undefined;
      entries.push({ type: 'chapter', title: displayTitle(text, { partPrefix, volumePrefix }), idx: i, synthetic: false });
      return;
    }
    if (l.type === 'volume') {
      const m = text.match(VOLUME_START_RE);
      const n = m ? numValue(m[1]) : NaN;
      const name = headingParts(text).name;
      if ((!Number.isNaN(n) && n === curVolume) || ((Number.isNaN(n) || curVolume === null) && namesMatch(name, curVolumeName))) {
        // 与当前卷编号相同，或一侧编号未知时卷名一致：重复的卷标题，不另建卷（标题行已在 dropLines 里）。
        // 两侧都有编号且不同时是不同的卷，卷名互相包含（如「风起」「风起云涌」）也不合并
        notes.push(`第 ${c.lineNo + 1} 行是重复的分卷标题，已去掉：${c.text}`);
        return;
      }
      if (!Number.isNaN(n)) curVolume = n;
      curVolumeName = name;
      entries.push({ type: 'volume', title: displayTitle(text, { partPrefix }), idx: i, synthetic: false });
      return;
    }
    // AI 指出这一章开始了新的一卷（前面没有对应的独立卷标题行）
    const volumeTitle = l.type === 'chapter' ? l.volumeTitle : undefined;
    const vtName = volumeTitle ? volumeNameKey(volumeTitle) : '';
    const last = entries[entries.length - 1];
    if (vtName && curVolume !== null && !curVolumeName && last && last.type === 'volume') {
      // 当前卷有编号但没有卷名（如单独一行「第三卷」）、且还没有章：volumeTitle 就是这一卷的卷名，
      // 只补上卷名（卷标题保持原文），编号保留，不另建卷
      curVolumeName = vtName;
    } else if (volumeTitle && vtName && !namesMatch(vtName, curVolumeName)) {
      curVolume = null;
      curVolumeName = vtName;
      aiVolumes.push(volumeTitle);
      entries.push({ type: 'volume', title: volumeTitle, idx: i, synthetic: true });
    }
    entries.push({ type: 'chapter', title: displayTitle(text, { partPrefix }), idx: i, synthetic: false });
  });
  if (partCount > 0) notes.push(`从章节标题前缀推断出 ${partCount} 个分部`);
  if (volumeCount > 0) notes.push(`从章节标题前缀推断出 ${volumeCount} 个分卷`);
  if (aiVolumes.length > 0) notes.push(`AI 指出 ${aiVolumes.length} 处新分卷：${aiVolumes.join('、')}`);
  return entries;
}

/**
 * 标题行（候选下标 idx）到下一个标题行之间有没有正文：
 * 非候选正文行（计在 bodyChars 里）或未被去掉的候选行都算正文。headIdx 为各标题行候选下标（按原文顺序）
 */
function hasBodyAfter(candidates: Candidate[], dropLines: Set<number>, headIdx: number[], idx: number): boolean {
  const next = headIdx[headIdx.indexOf(idx) + 1];
  const end = next === undefined ? candidates.length : next;
  for (let j = idx; j < end; j++) {
    if (candidates[j].bodyChars > 0) return true;
    if (j > idx && !dropLines.has(candidates[j].lineNo)) return true;
  }
  return false;
}

/**
 * 卷前言归位：行首「第Y卷」、不带章号的章（如「第三卷 怒晴湘西 前言」），紧接着是编号同为 Y 的独立卷行时，
 * 把这一章移到该卷之后（成为该卷第一章）。只在卷标题行后没有正文时移动——此时卷只有标题、不输出正文，
 * 各条目字节区间仍按原文位置，输出的正文顺序与原文一致；卷标题行后有正文时不移动，记 note
 */
function placeVolumePrefaces(
  entries: GroupEntry[], candidates: Candidate[], labels: Label[], dropLines: Set<number>, headIdx: number[], notes: string[],
): GroupEntry[] {
  const out = entries.slice();
  for (let k = 0; k + 1 < out.length; k++) {
    const e = out[k];
    const v = out[k + 1];
    if (e.type !== 'chapter' || e.synthetic || v.type !== 'volume' || v.synthetic) continue;
    const text = candidates[e.idx].text.trim();
    const m = text.match(VOLUME_START_RE);
    if (!m || headingParts(text).unit === 'chapter') continue;
    // 下一个结构性标签必须就是这个卷行
    let j = e.idx + 1;
    while (j < labels.length && !isStructural(labels[j])) j++;
    if (j !== v.idx) continue;
    const vm = candidates[v.idx].text.trim().match(VOLUME_START_RE);
    if (!vm || numValue(vm[1]) !== numValue(m[1])) continue;
    if (hasBodyAfter(candidates, dropLines, headIdx, v.idx)) {
      notes.push(`第 ${candidates[e.idx].lineNo + 1} 行像是卷前言，但卷标题后有正文，未调整位置：${candidates[e.idx].text}`);
      continue;
    }
    out[k] = v;
    out[k + 1] = e;
    k++;
  }
  return out;
}

/** 由判定结果生成章节结构。labels 与 candidates 下标对齐 */
export function buildStructure(candidates: Candidate[], labels: Label[], fileSize: number): OrgStructure {
  const dropLines = new Set<number>();
  const notes: string[] = [];
  // 最近的部 / 卷 / 章标题行
  let prevHeading: Candidate | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const l = labels[i];
    if (isStructural(l)) {
      dropLines.add(c.lineNo);
      prevHeading = c;
    } else if (l.type === 'duplicate') {
      // AI 误判时不能悄悄删掉正文：只有与上一标题一致才去掉
      if (prevHeading && isDuplicateOf(c.text, prevHeading.text)) dropLines.add(c.lineNo);
      else notes.push(`第 ${c.lineNo + 1} 行被判为重复标题，但与上一标题不一致，已保留为正文：${c.text}`);
    } else if (l.type === 'noise' && l.noiseKind === 'stray_number' && isStrictStrayNumber(c.text)) {
      dropLines.add(c.lineNo);
    }
  }

  const grouped = inferGroups(candidates, labels, dropLines, notes);
  // 各标题行候选下标，按原文顺序（卷前言归位后输出顺序会变，字节区间仍按原文位置算）
  const headIdx = grouped.filter(e => !e.synthetic).map(e => e.idx);
  const entries = placeVolumePrefaces(grouped, candidates, labels, dropLines, headIdx, notes);
  const hasPart = entries.some(e => e.type === 'part');

  const sections: OrgSection[] = [];
  // 当前所在的部 / 卷（卷不在部里、章不在卷里时取上一层可用的层级）
  let inPart = false;
  let volumeLevel: number | null = null;
  for (const e of entries) {
    const c = candidates[e.idx];
    const k = headIdx.indexOf(e.idx);
    const next = headIdx[k + 1];
    const srcEnd = next === undefined ? fileSize : candidates[next].byteStart;

    let level: number;
    let groupOnly = false;
    if (e.type === 'part') {
      level = 0;
      inPart = true;
      volumeLevel = null;
    } else if (e.type === 'volume') {
      level = hasPart && inPart ? 1 : 0;
      volumeLevel = level;
    } else {
      level = volumeLevel !== null ? volumeLevel + 1 : inPart ? 1 : 0;
    }
    if (e.synthetic) {
      // 从前缀推断出的部 / 卷：只有标题，区间为空，落在触发它的标题行开头
      sections.push({ level: level as 0 | 1 | 2, title: e.title, groupOnly: true, srcStart: c.byteStart, srcEnd: c.byteStart });
      continue;
    }
    if (e.type !== 'chapter') groupOnly = !hasBodyAfter(candidates, dropLines, headIdx, e.idx);
    sections.push({
      level: level as 0 | 1 | 2,
      title: e.title,
      groupOnly,
      srcStart: c.byteStart,
      srcEnd,
    });
  }

  // 卷前言归位后第一个条目不一定在原文最前：取最小的起点
  const firstStart = sections.length > 0 ? sections.reduce((m, x) => Math.min(m, x.srcStart), fileSize) : fileSize;
  const preface = firstStart > 0 ? { srcStart: 0, srcEnd: firstStart } : null;
  return { sections, dropLines, preface, notes };
}

/** 去掉首尾空白（含全角空格、\r）后的非空行 */
async function* normalizedLeft(
  filePath: string, dropLines: Set<number>, normalizeLine?: (text: string) => string,
): AsyncGenerator<string> {
  for await (const line of readTxtLines(filePath)) {
    if (dropLines.has(line.lineNo)) continue;
    const t = (normalizeLine ? normalizeLine(line.text) : line.text).trim();
    if (t) yield t;
  }
}

async function* normalizedRight(chapters: AsyncIterable<string>): AsyncGenerator<string> {
  for await (const ch of chapters) {
    for (const p of ch.split('\n')) {
      const t = p.trim();
      if (t) yield t;
    }
  }
}

/**
 * 逐字校验：左边 = 原文逐行去掉 dropLines、空行、行首尾空白后以 \n 拼接；右边 = 各章段落同样处理后拼接。
 * normalizeLine：原文每行先经过它再 trim（如去掉写 EPUB 时会去掉的控制字符）。
 * 两边都流式逐行比较；firstDiffAt 为拼接后文本里第一个不一致字符的位置（一边更长时为较短一边的长度）。
 */
export async function verifyVerbatim(
  filePath: string,
  structure: OrgStructure,
  renderedChapters: AsyncIterable<string>,
  normalizeLine?: (text: string) => string,
): Promise<{ ok: true } | { ok: false; firstDiffAt: number }> {
  const left = normalizedLeft(filePath, structure.dropLines, normalizeLine);
  const right = normalizedRight(renderedChapters);
  // 已比较过的拼接文本长度（含每行后的 \n）
  let offset = 0;
  try {
    for (;;) {
      const [a, b] = await Promise.all([left.next(), right.next()]);
      if (a.done && b.done) return { ok: true };
      if (a.done || b.done) return { ok: false, firstDiffAt: Math.max(0, offset - 1) };
      if (a.value !== b.value) {
        let k = 0;
        while (k < a.value.length && k < b.value.length && a.value[k] === b.value[k]) k++;
        return { ok: false, firstDiffAt: offset + k };
      }
      offset += a.value.length + 1;
    }
  } finally {
    await left.return(undefined);
    await right.return(undefined);
  }
}
