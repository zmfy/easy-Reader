import { normalizeTitle, levenshtein } from '../utils/title-normalizer';
import { lookupKey } from './title-lookup';
import { normalizeAuthor } from '../utils/author-match';

export interface ScannedBook {
  file_path: string;
  title: string;
  author?: string;
  fingerprint?: string;
  first_chapter_hash?: string;
  chapter_count?: number;
  first_chapter_preview?: string;
}

export interface CandidateGroups {
  /** 指纹完全相同的硬重复组（每组 ≥ 2 本） */
  hard_groups: ScannedBook[][];
  /** AI 软判定候选（每组 ≥ 2 本）。来源：
   *  - 归一化标题相同
   *  - 同作者 + 标题编辑距离 < 5
   *  - 章节数相同 + first_chapter_hash 相同（fingerprint 不同，可能是排版差异）
   */
  soft_groups: ScannedBook[][];
  /** 同 lookupKey(title) + 同 normalizeAuthor(author)，指纹不同（≥2 本、≥2 指纹）。 */
  title_author_groups: ScannedBook[][];
}

const AUTHOR_TITLE_DISTANCE_THRESHOLD = 5;

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

  // --- Soft group source 1: normalized title equal ---
  const byNorm = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue;
    if (inHard.has(b.file_path)) continue;
    const key = normalizeTitle(b.title);
    if (!key) continue;
    const arr = byNorm.get(key);
    if (arr) arr.push(b);
    else byNorm.set(key, [b]);
  }

  // --- Soft group source 2: same author + low title edit distance ---
  // Cluster within each author; union with norm groups via file_path membership.
  const byAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint || inHard.has(b.file_path)) continue;
    if (!b.author || !b.author.trim()) continue;
    const arr = byAuthor.get(b.author);
    if (arr) arr.push(b);
    else byAuthor.set(b.author, [b]);
  }
  const authorClusters: ScannedBook[][] = [];
  for (const [, sameAuthorBooks] of byAuthor) {
    if (sameAuthorBooks.length < 2) continue;
    const used = new Set<number>();
    for (let i = 0; i < sameAuthorBooks.length; i++) {
      if (used.has(i)) continue;
      const cluster = [sameAuthorBooks[i]];
      used.add(i);
      const baseTitle = normalizeTitle(sameAuthorBooks[i].title);
      for (let j = i + 1; j < sameAuthorBooks.length; j++) {
        if (used.has(j)) continue;
        const otherTitle = normalizeTitle(sameAuthorBooks[j].title);
        if (levenshtein(baseTitle, otherTitle) < AUTHOR_TITLE_DISTANCE_THRESHOLD) {
          cluster.push(sameAuthorBooks[j]);
          used.add(j);
        }
      }
      if (cluster.length >= 2) authorClusters.push(cluster);
    }
  }

  // --- Soft group source 3: same chapter_count + same first_chapter_hash ---
  // These have identical chapter structure but different fingerprint (probably
  // typesetting / whitespace differences). Strong signal for "same book".
  const byCcHash = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint || inHard.has(b.file_path)) continue;
    if (!b.chapter_count || !b.first_chapter_hash) continue;
    const key = `${b.chapter_count}::${b.first_chapter_hash}`;
    const arr = byCcHash.get(key);
    if (arr) arr.push(b);
    else byCcHash.set(key, [b]);
  }
  const ccHashClusters: ScannedBook[][] = [];
  for (const [, cluster] of byCcHash) {
    if (cluster.length >= 2) {
      const fps = new Set(cluster.map(b => b.fingerprint));
      if (fps.size >= 2) ccHashClusters.push(cluster);
    }
  }

  // --- Merge soft sources by file_path overlap ---
  // Two clusters that share any book → merge into one group (transitive closure).
  const allSoftSources: ScannedBook[][] = [];
  for (const [, group] of byNorm) {
    if (group.length >= 2) {
      const fps = new Set(group.map(b => b.fingerprint));
      if (fps.size >= 2) allSoftSources.push(group);
    }
  }
  allSoftSources.push(...authorClusters);
  allSoftSources.push(...ccHashClusters);

  const softGroups = mergeOverlappingClusters(allSoftSources);

  // --- Title + author groups (deterministic soft-dup, excludes hard members) ---
  // Kept separate from soft_groups (not merged) — this is an independent deterministic signal.
  const byTitleAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint || inHard.has(b.file_path)) continue;
    const author = normalizeAuthor(b.author ?? '');
    if (!author) continue;
    const titleKey = lookupKey(b.title);
    if (!titleKey) continue;
    const key = `${titleKey}::${author}`;
    const arr = byTitleAuthor.get(key);
    if (arr) arr.push(b);
    else byTitleAuthor.set(key, [b]);
  }
  const titleAuthorGroups: ScannedBook[][] = [];
  for (const [, group] of byTitleAuthor) {
    if (group.length < 2) continue;
    const fps = new Set(group.map(b => b.fingerprint));
    if (fps.size >= 2) titleAuthorGroups.push(group);
  }

  return { hard_groups: hardGroups, soft_groups: softGroups, title_author_groups: titleAuthorGroups };
}

/**
 * Merge clusters that share any book (by file_path) into a single group.
 * Uses union-find for transitive closure.
 */
function mergeOverlappingClusters(clusters: ScannedBook[][]): ScannedBook[][] {
  if (clusters.length === 0) return [];
  const parent: number[] = clusters.map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number): void => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const pathOwner = new Map<string, number>();
  for (let i = 0; i < clusters.length; i++) {
    for (const b of clusters[i]) {
      const prev = pathOwner.get(b.file_path);
      if (prev !== undefined) union(prev, i);
      else pathOwner.set(b.file_path, i);
    }
  }

  const merged = new Map<number, Map<string, ScannedBook>>();
  for (let i = 0; i < clusters.length; i++) {
    const root = find(i);
    let bucket = merged.get(root);
    if (!bucket) { bucket = new Map(); merged.set(root, bucket); }
    for (const b of clusters[i]) {
      if (!bucket.has(b.file_path)) bucket.set(b.file_path, b);
    }
  }
  return Array.from(merged.values())
    .map(m => Array.from(m.values()))
    .filter(g => g.length >= 2);
}
