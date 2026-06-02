import { getDb } from '../db';

export type CostTier = 'free' | 'low' | 'high' | 'unknown';

const TIER_MAP: Record<string, CostTier> = {
  ollama: 'free',
  deepseek: 'low',
  qwen: 'low',
  minmax: 'low',
  openai: 'high',
  claude: 'high',
};

export function tierForPlugin(name: string): CostTier {
  return TIER_MAP[name] ?? 'unknown';
}

export function getActivePluginName(): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'ai_plugin'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export interface EstimateInput {
  ai_dedup: boolean;
  ai_series: boolean;
  ai_fill: boolean;
  soft_dup_candidate_groups: number;
  series_fuzzy_groups: number;
  books_to_fill: number;
}

export interface EstimateOutput {
  dedup: number;
  series: number;
  fill: number;
  total: number;
}

export function estimateCalls(input: EstimateInput): EstimateOutput {
  const dedup = input.ai_dedup ? input.soft_dup_candidate_groups : 0;
  const series = input.ai_series ? input.series_fuzzy_groups : 0;
  const fill = input.ai_fill ? input.books_to_fill : 0;
  return { dedup, series, fill, total: dedup + series + fill };
}

/**
 * Best-effort pre-scan estimation. We don't actually walk the file system here
 * — instead we use heuristics based on the current books table.
 *
 * Note: this is approximate. The real scan may find more or fewer candidates.
 */
export function estimateFromCurrentDb(opts: {
  ai_dedup: boolean;
  ai_series: boolean;
  ai_fill: boolean;
  full_rescan: boolean;
}): EstimateOutput & { active_plugin: string | null; tier: CostTier } {
  const db = getDb();
  const totalBooks = (db.prepare("SELECT COUNT(*) as c FROM books").get() as { c: number }).c;
  const softGroups = Math.max(1, Math.floor(totalBooks / 20));
  const fuzzySeries = Math.max(1, Math.floor(totalBooks / 30));

  const fillCandidates = (db.prepare(
    "SELECT COUNT(*) as c FROM books WHERE status = 'normal' AND duplicate_of IS NULL AND ((author IS NULL OR author = '') OR (summary IS NULL OR summary = ''))"
  ).get() as { c: number }).c;

  const est = estimateCalls({
    ai_dedup: opts.ai_dedup,
    ai_series: opts.ai_series,
    ai_fill: opts.ai_fill,
    soft_dup_candidate_groups: softGroups,
    series_fuzzy_groups: fuzzySeries,
    books_to_fill: fillCandidates,
  });

  const active = getActivePluginName();
  return {
    ...est,
    active_plugin: active,
    tier: active ? tierForPlugin(active) : 'unknown',
  };
}
