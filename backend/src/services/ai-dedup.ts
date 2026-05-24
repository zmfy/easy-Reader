import { getDb } from '../db';
import { aiManager, AiDedupCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { DuplicateGroupPayload } from '../types';
import { isNotDuplicate } from './manual-override';

/**
 * For each soft-candidate group, call AI to judge real duplicates.
 * Returns final DuplicateGroupPayloads (one per AI-confirmed duplicate cluster).
 * Soft candidates not flagged as duplicates by AI are NOT returned (they'll be
 * treated as separate "new" books by the caller).
 */
export async function judgeSoftDuplicateGroups(
  softGroups: ScannedBook[][],
  bookIdResolver?: (file_path: string) => string | null,
): Promise<DuplicateGroupPayload[]> {
  const db = getDb();
  const out: DuplicateGroupPayload[] = [];

  for (const group of softGroups) {
    if (group.length < 2) continue;

    const candidates: AiDedupCandidate[] = group.map((b, i) => ({
      index: i,
      title: b.title,
      author: b.author,
      chapter_count: b.chapter_count,
      first_chapter_preview: b.first_chapter_preview ?? '',
    }));

    let aiResult;
    try {
      aiResult = await aiManager.judgeDuplicates(candidates, db);
    } catch (err) {
      console.error('AI dedup error, skipping group:', err);
      continue;
    }

    for (const aiGroup of aiResult.groups) {
      // Post-process: override AI's canonical pick with the member that has the
      // largest chapter_count. Reasoning: per-user spec, when AI judges several
      // books as duplicates, the most-complete version (most chapters) is the
      // "正本"; shorter copies go into the problem-books pile.
      const allIndices = [aiGroup.canonical_index, ...aiGroup.duplicate_indices];
      const distinct = Array.from(new Set(allIndices));
      distinct.sort((a, b) => {
        const cca = group[a].chapter_count ?? 0;
        const ccb = group[b].chapter_count ?? 0;
        if (ccb !== cca) return ccb - cca;
        // tie-breaker: shorter file_path (closer to root) wins
        return group[a].file_path.length - group[b].file_path.length;
      });
      const canonicalIdx = distinct[0];
      const dupIndices = distinct.slice(1);
      const canonical = group[canonicalIdx];
      const dups = dupIndices.map(i => group[i]);

      // manual_overrides filter
      if (bookIdResolver) {
        const canonicalId = bookIdResolver(canonical.file_path);
        const filtered = dups.filter(d => {
          const dupId = bookIdResolver(d.file_path);
          if (!canonicalId || !dupId) return true;
          return !isNotDuplicate(canonicalId, dupId);
        });
        if (filtered.length === 0) continue;
        out.push({
          canonical_file_path: canonical.file_path,
          members: [
            { file_path: canonical.file_path, fingerprint: canonical.fingerprint ?? '', decision_type: 'ai' },
            ...filtered.map(d => ({ file_path: d.file_path, fingerprint: d.fingerprint ?? '', decision_type: 'ai' as const })),
          ],
        });
      } else {
        out.push({
          canonical_file_path: canonical.file_path,
          members: [
            { file_path: canonical.file_path, fingerprint: canonical.fingerprint ?? '', decision_type: 'ai' },
            ...dups.map(d => ({ file_path: d.file_path, fingerprint: d.fingerprint ?? '', decision_type: 'ai' as const })),
          ],
        });
      }
    }
  }

  return out;
}
