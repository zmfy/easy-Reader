import { normalizeTitle } from '../utils/title-normalizer';

export interface LibraryBookForLookup {
  id: string;
  title: string;
  author?: string | null;
  chapter_count?: number | null;
}

export interface TitleQuery {
  title: string;
  author?: string;
}

export interface TitleLookupResult {
  title: string;
  author?: string;
  book_id: string | null;
}

/**
 * Build a loose matching key for similar-works linking.
 *
 * Library titles are often polluted with decorations baked into the title
 * field, e.g. "《盗墓笔记》（实体封面全本）作者：南派三叔". Strip the title
 * brackets, parenthetical annotations like （实体版全本）, and a trailing
 * "作者：…" segment before applying the shared volume/width/case normalizer, so
 * a clean AI-suggested base title like "盗墓笔记" links to the in-library book.
 */
export function lookupKey(title: string): string {
  const stripped = title
    .replace(/作者[:：].*$/, '')              // trailing "作者：…" metadata
    .replace(/[（(][^（()）]*[)）]/g, '')        // （…全本）/(…) annotation groups
    .replace(/[《》【】〈〉「」『』\[\]]/g, '');   // title-wrapping brackets
  return normalizeTitle(stripped);
}

/**
 * Resolve AI-suggested "similar work" titles to in-library books.
 *
 * Matching uses lookupKey on both sides so a base title like "盗墓笔记" links to
 * an in-library numbered volume ("盗墓笔记1") or a decoration-polluted entry
 * ("《盗墓笔记》作者：南派三叔").
 *
 * When several library books share the same key, the best match is picked by
 * score: exact-title + same-author wins, then exact-title with an unknown
 * library author, then same-author (non-exact, e.g. base→volume), then an
 * exact title whose author conflicts, with chapter count as a tiebreaker.
 */
export function matchTitlesToBooks(
  queries: TitleQuery[],
  books: LibraryBookForLookup[],
): TitleLookupResult[] {
  // Index library books by loose lookup key.
  const byKey = new Map<string, LibraryBookForLookup[]>();
  for (const b of books) {
    const key = lookupKey(b.title);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(b);
    byKey.set(key, arr);
  }

  return queries.map(q => {
    const qkey = lookupKey(q.title);
    const candidates = qkey ? byKey.get(qkey) ?? [] : [];
    if (candidates.length === 0) {
      return { title: q.title, author: q.author, book_id: null };
    }
    const chosen = pickBest(q, candidates);
    return { title: q.title, author: q.author, book_id: chosen.id };
  });
}

function pickBest(q: TitleQuery, candidates: LibraryBookForLookup[]): LibraryBookForLookup {
  const queryAuthor = q.author?.trim();
  const queryTitle = q.title.trim();

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const b of candidates) {
    const candAuthor = b.author?.trim();
    const exact = b.title.trim() === queryTitle;
    const authorMatch = !!queryAuthor && !!candAuthor && candAuthor === queryAuthor;
    // The candidate's author CONTRADICTS the query (both present, different) vs.
    // merely being unknown. An exact title with an unknown author is trustworthy;
    // an exact title whose author conflicts is not (likely a same-name other work).
    const authorConflict = !!queryAuthor && !!candAuthor && candAuthor !== queryAuthor;
    let score = 0;
    if (exact && (!queryAuthor || authorMatch)) score += 1000;     // exact title + author agrees (or none asked)
    else if (exact && !authorConflict) score += 800;               // exact title, library author unknown → trust title
    else if (authorMatch) score += 500;                            // author agrees, title not exact (base→volume)
    else if (exact) score += 250;                                  // exact title but author conflicts → weak
    // Completeness tiebreaker (capped so it never outranks a tier).
    score += Math.min(b.chapter_count ?? 0, 200) / 1000;
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return best;
}
