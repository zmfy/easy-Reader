/**
 * Normalize a book title for grouping: strip volume/episode suffixes,
 * convert full-width to half-width, collapse whitespace.
 */
export function normalizeTitle(title: string): string {
  return title
    // Full-width digits → half-width
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xff10 + 0x30))
    // Full-width spaces → half-width
    .replace(/　/g, ' ')
    // Strip parenthesized suffix like (上) (下) （续）
    .replace(/[（(][^（()）]{1,5}[)）]\s*$/, '')
    // Strip "第N部/集/册/卷"
    .replace(/\s*第\s*[零一二三四五六七八九十百千\d]+\s*[部集册卷]\s*$/, '')
    // Strip trailing 上/中/下/续/完结/终
    .replace(/\s*[上中下续终完]\s*$/, '')
    .replace(/\s*完结\s*$/, '')
    // Strip trailing digits with optional space
    .replace(/\s*\d+\s*$/, '')
    // Collapse whitespace
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Compute Levenshtein distance between two strings.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Extract the author from a book filename like
 * "《黄金瞳》（精校版全本）作者：打眼.txt" → "打眼".
 * Returns null when no "作者：…" segment is present.
 */
export function extractAuthorFromName(name: string): string | null {
  const noExt = name.replace(/\.[^.]+$/, '');
  const m = noExt.match(/作者[：:]\s*(.+?)\s*$/);
  if (!m) return null;
  const author = m[1].replace(/\s*[（(][^（()）]*[)）]\s*$/, '').trim();
  return author || null;
}
