/**
 * What a counsel run cost, from defence_package_runs.stage_tokens (cost
 * refactor §6). List prices in USD per million tokens; a model not listed is
 * priced as the default writer model so an override is never counted as free.
 *
 * The same prices are in scripts/sql/counsel-cost-daily.sql — change both.
 */

import type { CounselStageUsage } from "./run";

/** The per-package budget: the template writer's cost on the same case. */
export const COUNSEL_COST_BUDGET_USD = 0.05;

const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export function stageCostUsd(s: CounselStageUsage): number {
  const p = PRICES[s.model] ?? PRICES["claude-sonnet-4-6"];
  return (s.input * p.input + s.output * p.output + s.cacheRead * p.cacheRead + s.cacheWrite * p.cacheWrite) / 1_000_000;
}

export function runCostUsd(stages: readonly CounselStageUsage[]): number {
  return stages.reduce((sum, s) => sum + stageCostUsd(s), 0);
}

/** The q-quantile (0–1) of a list, by nearest rank. 0 for an empty list. */
export function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
