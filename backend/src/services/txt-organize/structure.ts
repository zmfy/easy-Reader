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
}

const STRAY_NUMBER_RE = /^第[零〇一二两三四五六七八九十百千万\d]+[章节回集]$/;

/** 去掉空白后整行只有「第 N 章 / 节 / 回 / 集」 */
export function isStrictStrayNumber(text: string): boolean {
  return STRAY_NUMBER_RE.test(text.replace(/\s+/g, ''));
}

const isStructural = (l: Label) => l.type === 'part' || l.type === 'volume' || l.type === 'chapter';

/** 该候选行是否从正文去掉（标题行、duplicate、合格的 stray_number） */
function isDropped(c: Candidate, l: Label): boolean {
  if (isStructural(l) || l.type === 'duplicate') return true;
  return l.type === 'noise' && l.noiseKind === 'stray_number' && isStrictStrayNumber(c.text);
}

/** 由判定结果生成章节结构。labels 与 candidates 下标对齐 */
export function buildStructure(candidates: Candidate[], labels: Label[], fileSize: number): OrgStructure {
  const dropLines = new Set<number>();
  candidates.forEach((c, i) => {
    if (isDropped(c, labels[i])) dropLines.add(c.lineNo);
  });

  const headIdx = candidates.map((_, i) => i).filter(i => isStructural(labels[i]));
  const hasPart = headIdx.some(i => labels[i].type === 'part');

  const sections: OrgSection[] = [];
  // 当前所在的部 / 卷（卷不在部里、章不在卷里时取上一层可用的层级）
  let inPart = false;
  let volumeLevel: number | null = null;
  headIdx.forEach((i, k) => {
    const c = candidates[i];
    const l = labels[i];
    const next = headIdx[k + 1];
    const srcEnd = next === undefined ? fileSize : candidates[next].byteStart;

    let level: number;
    let groupOnly = false;
    if (l.type === 'part') {
      level = 0;
      inPart = true;
      volumeLevel = null;
    } else if (l.type === 'volume') {
      level = hasPart && inPart ? 1 : 0;
      volumeLevel = level;
    } else {
      level = volumeLevel !== null ? volumeLevel + 1 : inPart ? 1 : 0;
    }
    if (l.type !== 'chapter') {
      // 标题行到下一个标题之间：非候选正文行（计在 bodyChars 里）或未被去掉的候选行都算正文
      const end = next === undefined ? candidates.length : next;
      let hasBody = false;
      for (let j = i; j < end && !hasBody; j++) {
        if (candidates[j].bodyChars > 0) hasBody = true;
        else if (j > i && !dropLines.has(candidates[j].lineNo)) hasBody = true;
      }
      groupOnly = !hasBody;
    }
    sections.push({
      level: level as 0 | 1 | 2,
      title: l.title || c.text,
      groupOnly,
      srcStart: c.byteStart,
      srcEnd,
    });
  });

  const firstStart = sections.length > 0 ? sections[0].srcStart : fileSize;
  const preface = firstStart > 0 ? { srcStart: 0, srcEnd: firstStart } : null;
  return { sections, dropLines, preface };
}

/** 去掉首尾空白（含全角空格、\r）后的非空行 */
async function* normalizedLeft(filePath: string, dropLines: Set<number>): AsyncGenerator<string> {
  for await (const line of readTxtLines(filePath)) {
    if (dropLines.has(line.lineNo)) continue;
    const t = line.text.trim();
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
 * 两边都流式逐行比较；firstDiffAt 为拼接后文本里第一个不一致字符的位置（一边更长时为较短一边的长度）。
 */
export async function verifyVerbatim(
  filePath: string,
  structure: OrgStructure,
  renderedChapters: AsyncIterable<string>,
): Promise<{ ok: true } | { ok: false; firstDiffAt: number }> {
  const left = normalizedLeft(filePath, structure.dropLines);
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
