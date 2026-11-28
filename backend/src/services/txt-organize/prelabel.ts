import { chapterNumberValue } from '../../plugins/parser-txt';
import { Candidate } from './candidates';
import { Label } from './judge';
import { isStrictStrayNumber } from './structure';

const NUM = '[零〇一二两三四五六七八九十百千万\\d]+';
/** 有章名的章节行：可选「第X卷/部」前缀 + 第N章 + 非空章名（已去空白、全角数字转半角） */
const NAMED_CHAPTER_RE = new RegExp(`^(?:第[^章]*?[卷部].*?)?第(${NUM})章(.+)$`);
const CHAPTER_NUM_RE = new RegExp(`第${NUM}章`);
const STRAY_CHAPTER_RE = new RegExp(`^第(${NUM})章$`);
const VOLUME_RE = /^第\S+?[卷部]/;

const MIN_BODY_CHARS = 300;

const compact = (text: string) => text
  .replace(/\s+/g, '')
  .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));

/**
 * 快速模式的规则预标注：只认「干净」的两类行，其余一律 null 交给 AI。
 * - 编号链上、有章名、正文足够、文字没出现过的章节行 → chapter
 * - 链已建立后，整行只有编号且编号 ≤ last 的「第N章」 → noise / stray_number
 * 返回值与 candidates 下标对齐。
 */
export function prelabelCandidates(candidates: Candidate[]): Array<Label | null> {
  let last = 0;
  let established = false;
  let pending: number | null = null;
  const seen = new Set<string>();

  return candidates.map((c): Label | null => {
    const key = c.text.trim();
    const s = compact(c.text);
    let label: Label | null = null;

    const named = s.match(NAMED_CHAPTER_RE);
    const n = named ? chapterNumberValue(named[1]) : NaN;
    if (named && !Number.isNaN(n)) {
      if (n === last + 1) {
        if (pending !== null || n === 1) established = true;
        last = n;
        pending = null;
        if (established && c.bodyChars >= MIN_BODY_CHARS && !seen.has(key)) label = { id: c.id, type: 'chapter' };
      } else if (pending !== null && n === pending + 1) {
        last = n;
        established = true;
        pending = null;
      } else {
        pending = n;
        established = false;
      }
    } else if (isStrictStrayNumber(c.text) && STRAY_CHAPTER_RE.test(s)) {
      const sn = chapterNumberValue(s.match(STRAY_CHAPTER_RE)![1]);
      if (established && !Number.isNaN(sn) && sn <= last) label = { id: c.id, type: 'noise', noiseKind: 'stray_number' };
    } else if (VOLUME_RE.test(s) && !CHAPTER_NUM_RE.test(s)) {
      established = false;
    }

    seen.add(key);
    return label;
  });
}
