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
  /** 组内至少 2 种指纹的确定性软重复（可能包含 hard_groups 的成员）：同 lookupKey(title) + 同 normalizeAuthor(author)，
   *  或严格标题相同且作者不冲突（相同或为空，如同一本书的 epub / txt）。 */
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

  // --- Title + author groups (deterministic soft-dup) ---
  // Kept separate from soft_groups (not merged) — this is an independent deterministic signal.
  // 可以包含硬重复组的成员（如「西游记.umd」与「易中天品三国.umd」指纹相同，「易中天品三国.epub」
  // 只能靠书名和后者配对），由调用方用 mergeDuplicateGroups 并入硬重复组。
  const byTitleAuthor = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue;
    const author = normalizeAuthor(b.author ?? '');
    if (!author) continue;
    const titleKey = lookupKey(b.title);
    if (!titleKey) continue;
    const key = `${titleKey}::${author}`;
    const arr = byTitleAuthor.get(key);
    if (arr) arr.push(b);
    else byTitleAuthor.set(key, [b]);
  }
  const titleAuthorClusters: ScannedBook[][] = [];
  for (const [, group] of byTitleAuthor) {
    if (group.length < 2) continue;
    const fps = new Set(group.map(b => b.fingerprint));
    if (fps.size >= 2) titleAuthorClusters.push(group);
  }

  // --- Same exact title, compatible authors ---
  // 扫描时作者只能从文件名解析，「易中天品三国.epub」「易中天品三国.txt」都没有作者，
  // 不同格式的指纹又必然不同，上面的规则抓不到。这里用不去卷号的严格标题键（避免
  // 「斗罗大陆1 / 2」被合并），作者相同或为空都算；同标题下出现两个不同作者时有歧义，交给上面的规则。
  const byExactTitle = new Map<string, ScannedBook[]>();
  for (const b of books) {
    if (!b.fingerprint) continue;
    const key = exactTitleKey(b.title);
    if (!key) continue;
    const arr = byExactTitle.get(key);
    if (arr) arr.push(b);
    else byExactTitle.set(key, [b]);
  }
  for (const [, group] of byExactTitle) {
    if (group.length < 2) continue;
    const authors = new Set(group.map(b => normalizeAuthor(b.author ?? '')).filter(Boolean));
    if (authors.size > 1) continue;
    const fps = new Set(group.map(b => b.fingerprint));
    if (fps.size >= 2) titleAuthorClusters.push(group);
  }

  return {
    hard_groups: hardGroups,
    soft_groups: softGroups,
    title_author_groups: mergeOverlappingClusters(titleAuthorClusters),
  };
}

/** 只去掉书名号、「作者：…」、空白和全角差异，保留卷号 / 上下册等区分分卷的部分 */
function exactTitleKey(title: string): string {
  return title
    .replace(/作者[:：].*$/, '')
    .replace(/[《》【】〈〉「」『』\[\]]/g, '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　]+/g, '')
    .toLowerCase();
}

/**
 * 合并硬重复组和书名软重复组：有共同成员的组合成一组，避免同一本书出现在两个重复组里。
 * 成员的判定类型：在任一硬重复组里为 hard，否则为 soft。
 */
export function mergeDuplicateGroups(
  hardGroups: ScannedBook[][],
  softGroups: ScannedBook[][],
): Array<{ books: ScannedBook[]; hardPaths: Set<string> }> {
  const hardPaths = new Set(hardGroups.flat().map(b => b.file_path));
  return mergeOverlappingClusters([...hardGroups, ...softGroups]).map(books => ({
    books,
    hardPaths: new Set(books.filter(b => hardPaths.has(b.file_path)).map(b => b.file_path)),
  }));
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

/**
 * Remove members an admin has declared "not a duplicate" (manual_overrides
 * not_duplicate pairs). A member is dropped when it is declared not-duplicate
 * with every other remaining member; groups left with fewer than 2 members
 * disappear. Members without a book id (new files) are never dropped.
 * Without this, a group the admin rejected ("非重复，加入书库") is regenerated
 * on every scan from the unchanged fingerprints, so review mode never empties.
 *
 * @param notDuplicatePairs set of "idA|idB" (both orders present)
 */
export function applyNotDuplicateOverrides(
  groups: ScannedBook[][],
  idByPath: Map<string, string>,
  notDuplicatePairs: Set<string>,
): ScannedBook[][] {
  if (notDuplicatePairs.size === 0) return groups;
  const notDup = (a: ScannedBook, b: ScannedBook): boolean => {
    const ia = idByPath.get(a.file_path);
    const ib = idByPath.get(b.file_path);
    return !!ia && !!ib && notDuplicatePairs.has(`${ia}|${ib}`);
  };
  const out: ScannedBook[][] = [];
  for (const group of groups) {
    const members = [...group];
    let changed = true;
    while (changed && members.length >= 2) {
      changed = false;
      const idx = members.findIndex(m => members.every(o => o === m || notDup(m, o)));
      if (idx >= 0) {
        members.splice(idx, 1);
        changed = true;
      }
    }
    if (members.length >= 2) out.push(members);
  }
  return out;
}
