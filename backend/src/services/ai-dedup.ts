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
      const canonical = group[aiGroup.canonical_index];
      const dups = aiGroup.duplicate_indices.map(i => group[i]);

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
