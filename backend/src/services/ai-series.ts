import pLimit from 'p-limit';
import { getDb } from '../db';
import { aiManager, AiSeriesCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { SeriesGroupPayload } from '../types';
import { levenshtein, normalizeTitle } from '../utils/title-normalizer';
import { setScanProgress } from './scan-task';

const FUZZY_THRESHOLD = 3;
const PREFIX_LENGTH = 4;
const MAX_GROUP_SIZE = 20;        // 避免一组太大塞爆 AI prompt
const CONCURRENCY = 3;

/**
 * For books not already grouped by regex, build fuzzy candidate groups from
 * two sources and ask AI to confirm series:
 *   1. Same author + Levenshtein distance < 3 (high confidence)
 *   2. Same normalized title prefix (first {PREFIX_LENGTH} chars) — even
 *      without author info (lots of imported books lack author).
 */
export async function judgeFuzzySeriesGroups(
  books: ScannedBook[],
  alreadyGroupedPaths: Set<string>,
  taskId?: string,
): Promise<SeriesGroupPayload[]> {
  const db = getDb();

  // Source 1: cluster by author
  const byAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (alreadyGroupedPaths.has(b.file_path)) continue;
    const author = b.author ?? '';
    if (!author) continue;
    const arr = byAuthor.get(author) ?? [];
    arr.push(b);
    byAuthor.set(author, arr);
  }

  const authorClusters: ScannedBook[][] = [];
  for (const [, members] of byAuthor) {
    if (members.length < 2) continue;
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
      if (group.length >= 2) authorClusters.push(group);
    }
  }

  // Source 2: cluster by normalized title prefix (works even without author)
  const byPrefix = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (alreadyGroupedPaths.has(b.file_path)) continue;
    const norm = normalizeTitle(b.title);
    if (norm.length < PREFIX_LENGTH) continue;
    const prefix = norm.slice(0, PREFIX_LENGTH);
    const arr = byPrefix.get(prefix) ?? [];
    arr.push(b);
    byPrefix.set(prefix, arr);
  }
  const prefixClusters: ScannedBook[][] = [];
  for (const [, group] of byPrefix) {
    if (group.length >= 2 && group.length <= MAX_GROUP_SIZE) {
      prefixClusters.push(group);
    }
  }

  // Merge: a book might land in both sources — dedup by file_path within each cluster
  const fuzzyGroups: ScannedBook[][] = [];
  const seenSignatures = new Set<string>();
  for (const cluster of [...authorClusters, ...prefixClusters]) {
    const paths = [...new Set(cluster.map(b => b.file_path))].sort();
    const sig = paths.join('|');
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);
    if (paths.length >= 2) fuzzyGroups.push(cluster);
  }

  const out: SeriesGroupPayload[] = [];
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  if (taskId && fuzzyGroups.length > 0) {
    setScanProgress(taskId, { total_files: fuzzyGroups.length, processed_files: 0 });
  }

  await Promise.all(fuzzyGroups.map(group => limit(async () => {
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
      done++;
      if (taskId) setScanProgress(taskId, { processed_files: done });
      return;
    }
    if (!aiResult.is_series || !aiResult.members || !aiResult.series_name) {
      done++;
      if (taskId) setScanProgress(taskId, { processed_files: done });
      return;
    }
    if ((aiResult.confidence ?? 'medium') === 'low') {
      done++;
      if (taskId) setScanProgress(taskId, { processed_files: done });
      return;
    }

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
    done++;
    if (taskId) setScanProgress(taskId, { processed_files: done });
  })));
  return out;
}
