export interface ScannedBookForSeries {
  file_path: string;
  title: string;
  author?: string;
}

export interface SeriesCandidate {
  series_name: string;
  author?: string;
  members: Array<{ file_path: string; sequence: number; original_title: string }>;
}

/**
 * Match common series patterns and extract groups.
 * Returns groups with >=2 members sharing the same author + base title.
 *
 * Recognized patterns (order matters — first match wins):
 *  - "X 第N部/集/册/卷"           e.g. 遮天 第一部
 *  - "X(N)" / "X（N）" / "X[N]"   e.g. 女生宿舍(1), 女生宿舍（一）
 *  - "X N" / "X-N" / "X_N"        e.g. 女生宿舍1, 女生宿舍 2, 女生宿舍-3
 *  - "X 上/中/下/续"              e.g. 三体 上
 *  - "N.X" / "N X" / "N_X"        e.g. 01.女生宿舍, 1 女生宿舍 (numeric prefix)
 *
 * Title decorations (《》, leading/trailing brackets, full-width spaces) are
 * stripped before matching so they don't break grouping.
 */
export function extractSeriesCandidates(books: ScannedBookForSeries[]): SeriesCandidate[] {
  type ParseResult = { base: string; sequence: number } | null;
  const parsed: Array<{ book: ScannedBookForSeries; parsed: ParseResult }> = books.map(b => ({
    book: b,
    parsed: parseTitle(b.title),
  }));

  // Group by (author, base_title). Empty author groups books that share base title.
  const groups = new Map<string, Array<{ book: ScannedBookForSeries; sequence: number }>>();
  for (const { book, parsed: p } of parsed) {
    if (!p) continue;
    const key = `${book.author ?? ''}::${p.base.toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push({ book, sequence: p.sequence });
    groups.set(key, arr);
  }

  const result: SeriesCandidate[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    members.sort((a, b) => a.sequence - b.sequence);
    const [authorPart] = key.split('::');
    // Use the first member's parsed base (preserves original casing/chars)
    const firstParsed = parseTitle(members[0].book.title)!;
    result.push({
      series_name: firstParsed.base,
      author: authorPart || undefined,
      members: members.map(m => ({
        file_path: m.book.file_path,
        sequence: m.sequence,
        original_title: m.book.title,
      })),
    });
  }
  return result;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/**
 * Strip common decorative wrappers so pattern matching can see the bare title.
 * Only strips obvious decorations (《》【】[]「」『』); does NOT strip ()（） which
 * may be carrying a sequence number — those are handled by Pattern 2.
 */
function stripDecorations(t: string): string {
  // Full-width → half-width digits
  let s = t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30));
  s = s.replace(/　/g, ' ');                  // full-width space
  s = s.replace(/^[《【\[「『]+\s*/, '');         // leading wrappers (no parens)
  s = s.replace(/\s*[》】\]」』]+$/, '');         // trailing wrappers (no parens)
  return s.trim();
}

function parseTitle(title: string): { base: string; sequence: number } | null {
  const original = title.trim();
  const trimmed = stripDecorations(original);

  // Pattern 1: 第X部/集/册/卷 — e.g. "遮天 第一部"
  let m = trimmed.match(/^(.+?)\s*第\s*([零一二三四五六七八九十百千\d]+)\s*[部集册卷季]\s*$/);
  if (m) {
    const seq = parseCnNumber(m[2]);
    if (seq > 0) return { base: m[1].trim(), sequence: seq };
  }

  // Pattern 2: 带括号的序号 — e.g. "女生宿舍(1)" "女生宿舍（一）" "三体[II]"
  m = trimmed.match(/^(.+?)\s*[（(\[【「]\s*([零一二三四五六七八九十百千\d]+|[ivxIVX]+)\s*[）)\]】」]\s*$/);
  if (m && m[1].trim().length > 0) {
    const seq = parseCnNumber(m[2]) || parseRoman(m[2]);
    if (seq > 0) return { base: m[1].trim(), sequence: seq };
  }

  // Pattern 3: 末尾数字（含可选分隔符）— e.g. "女生宿舍1", "女生宿舍 2", "女生宿舍-3", "女生宿舍.4"
  m = trimmed.match(/^(.+?)[\s\-_．.,、~～]*(\d+)\s*$/);
  if (m && m[1].trim().length > 0) {
    // Reject when base ends digit-glued (avoid splitting "三体2024" into "三体" + 2024)
    // Heuristic: if the matched group of digits is "very long" (5+) treat it as part of title (year/code)
    const seq = parseInt(m[2], 10);
    if (m[2].length <= 4 && seq > 0) {
      return { base: m[1].trim(), sequence: seq };
    }
  }

  // Pattern 4: 末尾中文数字 — e.g. "女生宿舍一", "三体二"（仅在不与正文混淆时；要求前面是非中文数字字符）
  m = trimmed.match(/^(.+?[^零一二三四五六七八九十])([零一二三四五六七八九十])\s*$/);
  if (m && m[1].trim().length > 0) {
    const seq = parseCnNumber(m[2]);
    if (seq > 0 && seq <= 10) return { base: m[1].trim(), sequence: seq };
  }

  // Pattern 5: 上 / 中 / 下 / 续
  if (/.+\s*上$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*上$/, '').trim(), sequence: 1 };
  }
  if (/.+\s*中$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*中$/, '').trim(), sequence: 2 };
  }
  if (/.+\s*下$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*下$/, '').trim(), sequence: 3 };
  }
  if (/.+\s*续$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*续$/, '').trim(), sequence: 2 };
  }

  // Pattern 6: 前导数字 — e.g. "01.女生宿舍", "1 女生宿舍", "1-女生宿舍"
  m = trimmed.match(/^(\d{1,3})\s*[.\-_、\s]\s*(.+)$/);
  if (m && m[2].trim().length > 0) {
    return { base: m[2].trim(), sequence: parseInt(m[1], 10) };
  }

  return null;
}

function parseCnNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (s === '十') return 10;
  if (s.startsWith('十')) {
    const tail = s.slice(1);
    const tailN = CN_DIGITS[tail];
    return tailN !== undefined ? 10 + tailN : NaN;
  }
  if (s.endsWith('十')) {
    const head = s.slice(0, -1);
    const headN = CN_DIGITS[head];
    return headN !== undefined ? headN * 10 : NaN;
  }
  if (s.length === 1) return CN_DIGITS[s] ?? NaN;
  const m = s.match(/^([零一二三四五六七八九])十([零一二三四五六七八九])?$/);
  if (m) {
    const tens = CN_DIGITS[m[1]];
    const ones = m[2] ? CN_DIGITS[m[2]] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return NaN;
}

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
};
function parseRoman(s: string): number {
  return ROMAN[s.toLowerCase()] ?? 0;
}
