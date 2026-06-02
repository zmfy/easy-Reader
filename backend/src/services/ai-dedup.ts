import pLimit from 'p-limit';
import { getDb } from '../db';
import { aiManager, AiDedupCandidate } from '../ai/ai-manager';
import { ScannedBook } from './dedup-grouper';
import { DuplicateGroupPayload } from '../types';
import { isNotDuplicate } from './manual-override';
import { setScanProgress } from './scan-task';

const CONCURRENCY = 3;

/**
 * For each soft-candidate group, call AI in parallel (concurrency 3) to judge
 * real duplicates. Returns final DuplicateGroupPayloads (one per AI-confirmed
 * cluster). Soft candidates not flagged as duplicates by AI are NOT returned
 * (treated as separate "new" books by the caller).
 *
 * If taskId is passed, per-group progress is reported via setScanProgress so
 * the UI can show "AI 判定 X/Y 组".
 */
export async function judgeSoftDuplicateGroups(
  softGroups: ScannedBook[][],
  bookIdResolver?: (file_path: string) => string | null,
  taskId?: string,
): Promise<DuplicateGroupPayload[]> {
  const db = getDb();
  const out: DuplicateGroupPayload[] = [];
  const limit = pLimit(CONCURRENCY);
  let done = 0;
  const total = softGroups.filter(g => g.length >= 2).length;
  if (taskId && total > 0) {
    setScanProgress(taskId, { total_files: total, processed_files: 0 });
  }

  await Promise.all(softGroups.map(group => limit(async () => {
    if (group.length < 2) return;

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
      done++;
      if (taskId) setScanProgress(taskId, { processed_files: done });
      return;
    }

    for (const aiGroup of aiResult.groups) {
      const allIndices = [aiGroup.canonical_index, ...aiGroup.duplicate_indices];
      const distinct = Array.from(new Set(allIndices));
      distinct.sort((a, b) => {
        const cca = group[a].chapter_count ?? 0;
        const ccb = group[b].chapter_count ?? 0;
        if (ccb !== cca) return ccb - cca;
        return group[a].file_path.length - group[b].file_path.length;
      });
      const canonicalIdx = distinct[0];
      const dupIndices = distinct.slice(1);
      const canonical = group[canonicalIdx];
      const dups = dupIndices.map(i => group[i]);

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

    done++;
    if (taskId) setScanProgress(taskId, { processed_files: done });
  })));

  return out;
}
