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
 */
export function extractSeriesCandidates(books: ScannedBookForSeries[]): SeriesCandidate[] {
  type ParseResult = { base: string; sequence: number } | null;
  const parsed: Array<{ book: ScannedBookForSeries; parsed: ParseResult }> = books.map(b => ({
    book: b,
    parsed: parseTitle(b.title),
  }));

  // Group by (author, base_title)
  const groups = new Map<string, Array<{ book: ScannedBookForSeries; sequence: number }>>();
  for (const { book, parsed: p } of parsed) {
    if (!p) continue;
    const key = `${book.author ?? ''}::${p.base}`;
    const arr = groups.get(key) ?? [];
    arr.push({ book, sequence: p.sequence });
    groups.set(key, arr);
  }

  const result: SeriesCandidate[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    // sort by sequence
    members.sort((a, b) => a.sequence - b.sequence);
    const [authorPart, base] = key.split('::');
    result.push({
      series_name: base,
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

function parseTitle(title: string): { base: string; sequence: number } | null {
  const trimmed = title.trim();

  // Pattern 1: 第X部/集/册/卷 (allow leading whitespace)
  let m = trimmed.match(/^(.+?)\s*第\s*([零一二三四五六七八九十百千\d]+)\s*[部集册卷]\s*$/);
  if (m) {
    const seq = parseCnNumber(m[2]);
    if (seq > 0) return { base: m[1].trim(), sequence: seq };
  }

  // Pattern 2: 末尾数字 (e.g., 女生宿舍1, 女生宿舍 2, 女生宿舍－3)
  m = trimmed.match(/^(.+?)[\s\-_．.]*(\d+)\s*$/);
  if (m && m[1].length > 0) {
    return { base: m[1].trim(), sequence: parseInt(m[2], 10) };
  }

  // Pattern 3: 上中下
  if (/.+\s*上$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*上$/, '').trim(), sequence: 1 };
  }
  if (/.+\s*中$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*中$/, '').trim(), sequence: 2 };
  }
  if (/.+\s*下$/.test(trimmed)) {
    return { base: trimmed.replace(/\s*下$/, '').trim(), sequence: 3 };
  }

  return null;
}

function parseCnNumber(s: string): number {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  // Handle simple Chinese numerals (suffices for parts 1-99)
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
  // 二十三 etc.
  const m = s.match(/^([零一二三四五六七八九])十([零一二三四五六七八九])?$/);
  if (m) {
    const tens = CN_DIGITS[m[1]];
    const ones = m[2] ? CN_DIGITS[m[2]] : 0;
    if (tens !== undefined && ones !== undefined) return tens * 10 + ones;
  }
  return NaN;
}
