import { getDb } from '../db';
import { aiManager, AiSeriesCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { SeriesGroupPayload } from '../types';
import { levenshtein } from '../utils/title-normalizer';

const FUZZY_THRESHOLD = 3;

/**
 * For books not already grouped by regex, compute fuzzy candidates
 * (same author + Levenshtein distance < threshold) and ask AI to confirm series.
 */
export async function judgeFuzzySeriesGroups(
  books: ScannedBook[],
  alreadyGroupedPaths: Set<string>,
): Promise<SeriesGroupPayload[]> {
  const db = getDb();

  // Cluster by author
  const byAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (alreadyGroupedPaths.has(b.file_path)) continue;
    const author = b.author ?? '';
    if (!author) continue; // skip authorless for fuzzy
    const arr = byAuthor.get(author) ?? [];
    arr.push(b);
    byAuthor.set(author, arr);
  }

  const fuzzyGroups: ScannedBook[][] = [];
  for (const [, members] of byAuthor) {
    if (members.length < 2) continue;
    // Within author, cluster by pairwise distance
    const used = new Set<number>();
    for (let i = 0; i < members.length; i++) {
      if (used.has(i)) continue;
      const group = [members[i]];
      used.add(i);
      for (let j = i + 1; j < members.length; j++) {
        if (used.has(j)) continue;
        if (levenshtein(members[i].title, members[j].title) < FUZZY_THRESHOLD) {
          group.push(members[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) fuzzyGroups.push(group);
    }
  }

  const out: SeriesGroupPayload[] = [];
  for (const group of fuzzyGroups) {
    const candidates: AiSeriesCandidate[] = group.map((b, i) => ({
      index: i,
      title: b.title,
      author: b.author,
    }));
    let aiResult;
    try {
      aiResult = await aiManager.judgeSeries(candidates, db);
    } catch (err) {
      console.error('AI series error, skipping group:', err);
      continue;
    }
    if (!aiResult.is_series || !aiResult.members || !aiResult.series_name) continue;
    if ((aiResult.confidence ?? 'medium') === 'low') continue; // drop low-confidence

    out.push({
      series_name: aiResult.series_name,
      author: group[0].author,
      members: aiResult.members.map(m => ({
        file_path: group[m.index].file_path,
        sequence: m.sequence,
      })),
      source: 'ai',
      confidence: aiResult.confidence,
    });
  }
  return out;
}
