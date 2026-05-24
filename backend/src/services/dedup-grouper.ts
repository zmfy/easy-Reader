import { normalizeTitle } from '../utils/title-normalizer';

export interface ScannedBook {
  file_path: string;
  title: string;
  author?: string;
  fingerprint?: string;
  chapter_count?: number;
  first_chapter_preview?: string;
}

export interface CandidateGroups {
  /** 指纹完全相同的硬重复组（每组 ≥ 2 本） */
  hard_groups: ScannedBook[][];
  /** 标题归一化相同但指纹不同 → AI 软判定候选（每组 ≥ 2 本） */
  soft_groups: ScannedBook[][];
}

/**
 * Cluster scanned books into hard/soft duplicate candidate groups.
 * Hard groups: same fingerprint.
 * Soft groups: same normalized title, different fingerprint, exclude books already in hard groups.
 */
export function buildCandidateGroups(books: ScannedBook[]): CandidateGroups {
  // --- Hard groups by fingerprint ---
  const byFp = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue;
    const arr = byFp.get(b.fingerprint);
    if (arr) arr.push(b);
    else byFp.set(b.fingerprint, [b]);
  }
  const hardGroups: ScannedBook[][] = [];
  const inHard = new Set<string>(); // file_path
  for (const [, group] of byFp) {
    if (group.length >= 2) {
      hardGroups.push(group);
      for (const b of group) inHard.add(b.file_path);
    }
  }

  // --- Soft groups by normalized title (exclude books already in hard) ---
  const byNorm = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue; // can't dedup books without fingerprint
    if (inHard.has(b.file_path)) continue;
    const key = normalizeTitle(b.title);
    if (!key) continue;
    const arr = byNorm.get(key);
    if (arr) arr.push(b);
    else byNorm.set(key, [b]);
  }
  const softGroups: ScannedBook[][] = [];
  for (const [, group] of byNorm) {
    if (group.length >= 2) {
      // ensure distinct fingerprints (otherwise it'd already be a hard group, but defensive)
      const fps = new Set(group.map(b => b.fingerprint));
      if (fps.size >= 2) softGroups.push(group);
    }
  }

  return { hard_groups: hardGroups, soft_groups: softGroups };
}
