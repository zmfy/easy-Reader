import { getDb } from '../db';
import { selectFillCandidates } from './ai-batch-fill';

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
  ai_fill: boolean;
  books_to_fill: number;
}

export interface EstimateOutput {
  fill: number;
  total: number;
}

export function estimateCalls(input: EstimateInput): EstimateOutput {
  const fill = input.ai_fill ? input.books_to_fill : 0;
  return { fill, total: fill };
}

/**
 * Best-effort pre-scan estimation. We don't actually walk the file system here
 * — instead we use heuristics based on the current books table.
 *
 * Note: this is approximate. The real scan may find more or fewer candidates.
 */
export function estimateFromCurrentDb(opts: {
  ai_fill: boolean;
  // full_rescan is part of the scan API surface but does not change the fill estimate.
  full_rescan: boolean;
}): EstimateOutput & { active_plugin: string | null; tier: CostTier } {
  const db = getDb();
  // Mirror the real ai-fill candidate set (missing author/summary, not yet
  // filled at the current AI_FILL_VERSION) so the estimate matches what runs.
  const fillCandidates = selectFillCandidates(db, false).length;

  const est = estimateCalls({ ai_fill: opts.ai_fill, books_to_fill: fillCandidates });
  const active = getActivePluginName();
  return { ...est, active_plugin: active, tier: active ? tierForPlugin(active) : 'unknown' };
}
