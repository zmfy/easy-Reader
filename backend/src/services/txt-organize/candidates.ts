import { TxtParser } from '../../plugins/parser-txt';
import { readTxtLines } from './lines';

export interface Candidate {
  id: number;
  lineNo: number;
  byteStart: number;
  byteEnd: number;
  /** trim 后 */
  text: string;
  /** 到下一候选行之间非空正文字数 */
  bodyChars: number;
  bodyLines: number;
  /** 前一行非空文字的前 20 字 */
  prevSnippet: string;
  nextSnippet: string;
  ruleHint: 'heading' | 'volume' | 'none';
}

const MAX_CANDIDATE_CHARS = 60;
const SNIPPET_CHARS = 20;
/** 候选行行首：章节标题、括号附言、特殊章节、书名号 */
const CANDIDATE_START_RE = /^(?:第|正文|[【［\[〔（(]|chapter|楔子|序|引子|前言|尾声|后记|终章|番外|《)/i;
/** 「数字＋章名」（如「165 天崩」「1．10：古物」）：数字后接非数字、非标点的字符 */
const NUM_TITLE_RE = /^[0-9０-９]{1,4}[\s　.．、:：]*[^\d\s０-９。！？；，,.!?]/;
/** 「数字＋章名」整行字数上限 */
const MAX_NUM_TITLE_CHARS = 24;
/** 「数字＋章名」不得含的句内 / 句末标点 */
const NUM_TITLE_PUNCT_RE = /[。！？；，,!?]/;

function isNumTitle(text: string): boolean {
  return text.length <= MAX_NUM_TITLE_CHARS && NUM_TITLE_RE.test(text) && !NUM_TITLE_PUNCT_RE.test(text);
}

export async function collectCandidates(filePath: string, parser: TxtParser): Promise<{ candidates: Candidate[]; totalLines: number }> {
  const starts = parser.getHeadingStarts();
  const hintByByte = new Map<number, 'heading' | 'volume'>();
  starts.forEach((s, i) => {
    // 目录里比它深的条目紧随其后：它是分卷 / 分部
    hintByByte.set(s.byte, (starts[i + 1]?.level ?? 0) > s.level ? 'volume' : 'heading');
  });

  const candidates: Candidate[] = [];
  let totalLines = 0;
  let prevSnippet = '';
  // 还在等「下一行非空文字」的候选（最多一个）
  let awaitingNext: Candidate | null = null;

  for await (const line of readTxtLines(filePath)) {
    totalLines++;
    const text = line.text.trim();
    if (!text) continue;
    const hint = hintByByte.get(line.byteStart);
    const isCandidate = hint !== undefined
      || (text.length <= MAX_CANDIDATE_CHARS && CANDIDATE_START_RE.test(text))
      || isNumTitle(text);
    if (awaitingNext) {
      awaitingNext.nextSnippet = text.slice(0, SNIPPET_CHARS);
      awaitingNext = null;
    }
    if (isCandidate) {
      const cand: Candidate = {
        id: candidates.length, lineNo: line.lineNo, byteStart: line.byteStart, byteEnd: line.byteEnd, text,
        bodyChars: 0, bodyLines: 0, prevSnippet, nextSnippet: '', ruleHint: hint ?? 'none',
      };
      candidates.push(cand);
      awaitingNext = cand;
    } else if (candidates.length > 0) {
      const last = candidates[candidates.length - 1];
      last.bodyChars += text.length;
      last.bodyLines++;
    }
    prevSnippet = text.slice(0, SNIPPET_CHARS);
  }
  return { candidates, totalLines };
}
