/**
 * How much narrative generation is left in a shop's day — asked BEFORE work is
 * enqueued, not after it has been spent.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `narrativeWriter` has enforced a per-shop daily cap since Phase 3, and it
 * enforces it correctly — but only at the moment of generation, by which
 * point a `build_pack` job has already run every collector, rebuilt the pack,
 * inserted a defence-package draft and chained a `build_defence_package` job.
 * The refusal lands as `status: failed`, `failure_code: daily_cap_reached` on
 * a row that now sits ABOVE the case's last good package.
 *
 * Nothing upstream could see the budget, so a bulk rebuild was always a blind
 * bet. Measured on production 2026-08-12/13, three separate batches were
 * enqueued against an already-spent budget:
 *
 *   43 packs   the fingerprint sweep — exhausted the day's tokens
 *                (51 026 / 50 000) partway through
 *    6 packs   the capped disputes, re-enqueued — failed again
 *   11 packs   the post-v14 rebuild — 10 of 11 died on the cap without
 *                generating a single narrative
 *
 * Every one of those cost real jobs and left more `failed` rows to clean up.
 * The daily cap is a budget; enqueueing past it is not a retry, it is waste
 * with a side effect.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────
 *
 * Not a second enforcement point. `narrativeWriter` remains the authority and
 * still refuses at the boundary — a batch sized here can still be overtaken by
 * concurrent traffic, and must be. This is an ADVISORY read so callers can
 * size a batch to what is actually available, and say so, rather than
 * discovering it one failed package at a time.
 *
 * Nor is it a per-dispute gate. `evaluateGenerationGuard` decides whether a
 * given package may be regenerated at all; this only answers "how many can the
 * shop still afford today".
 */

import { getServiceClient } from "@/lib/supabase/server";
import { checkDailyCap } from "./narrativeWriter";
import { COUNSEL_DAILY_RUN_CAP } from "./counsel/run";

/** Mirrors `narrativeWriter`'s constants — same env vars, same defaults. */
export const DAILY_GENERATION_CAP = Number(
  process.env.DEFENCE_PACKAGE_DAILY_GENERATION_CAP ?? "100",
);
export const DAILY_TOKEN_CAP = Number(
  process.env.DEFENCE_PACKAGE_DAILY_TOKEN_CAP ?? "50000",
);

/**
 * Observed mean prompt tokens per narrative generation, used to convert the
 * remaining TOKEN budget into a number of builds. Deliberately conservative:
 * over-estimating the cost under-fills the batch, which wastes nothing, while
 * under-estimating refills it past the cap — the failure this module exists to
 * prevent. Measured 2026-08-12: 51 026 tokens across 44 generations ≈ 1 160.
 */
const ESTIMATED_TOKENS_PER_GENERATION = 1_400;

export interface GenerationBudget {
  /** Generations already spent in the shop's current daily bucket. */
  generationsUsed: number;
  /** Template-writer prompt tokens spent in that bucket (counsel runs excluded, as the cap does). */
  tokensUsed: number;
  /** Counsel v2 runs spent in that bucket. */
  counselRunsUsed: number;
  /** Generations still affordable — the binding of the limits. Never < 0. */
  remaining: number;
  /** True when nothing further can be generated today. */
  exhausted: boolean;
  /** Which limit binds. `null` when there is headroom. */
  bindingLimit: "generations" | "tokens" | "counsel_runs" | null;
}

const UNKNOWN: GenerationBudget = {
  generationsUsed: 0,
  tokensUsed: 0,
  counselRunsUsed: 0,
  remaining: DAILY_GENERATION_CAP,
  exhausted: false,
  bindingLimit: null,
};

/**
 * Read the remaining budget for one shop.
 *
 * Counts through `checkDailyCap`, the same read the build job refuses on, so
 * the advisory and the enforcement cannot disagree. Counsel v2 is the only
 * letter writer since 2026-09-28 and has its own per-day run cap
 * (`COUNSEL_DAILY_RUN_CAP`, 25): that is the limit a rebuild actually meets.
 * Mein Maison 2026-09-30: a settings toggle re-queued ~20 open packs, the
 * counsel cap ran out and two packages failed `daily_cap_reached` — while
 * this read, which knew only the template writer's caps, reported headroom.
 *
 * SOFT-FAILS OPEN, matching `checkDailyCap`. A failed count query must not
 * block a rebuild — the build job still enforces the real cap, so the worst
 * case of an optimistic read here is the behaviour we have today.
 */
export async function readGenerationBudget(shopId: string): Promise<GenerationBudget> {
  const sb = getServiceClient();
  let used: Awaited<ReturnType<typeof checkDailyCap>>;
  try {
    used = await checkDailyCap(sb, shopId);
  } catch (err) {
    console.warn("[defence] generation-budget query failed", err instanceof Error ? err.message : String(err));
    return UNKNOWN;
  }
  return budgetFromUsage(used);
}

/** The budget arithmetic, separated from the read for tests. */
export function budgetFromUsage(used: { generations: number; inputTokens: number; counselRuns: number }): GenerationBudget {
  const limits = {
    generations: Math.max(0, DAILY_GENERATION_CAP - used.generations),
    tokens: Math.max(0, Math.floor((DAILY_TOKEN_CAP - used.inputTokens) / ESTIMATED_TOKENS_PER_GENERATION)),
    counsel_runs: Math.max(0, COUNSEL_DAILY_RUN_CAP - used.counselRuns),
  } as const;
  const binding = (Object.keys(limits) as Array<keyof typeof limits>).reduce((a, b) => (limits[b] < limits[a] ? b : a));
  const remaining = limits[binding];
  return {
    generationsUsed: used.generations,
    tokensUsed: used.inputTokens,
    counselRunsUsed: used.counselRuns,
    remaining,
    exhausted: remaining <= 0,
    bindingLimit: remaining < DAILY_GENERATION_CAP ? binding : null,
  };
}

/**
 * A one-line, operator-readable statement of the budget.
 *
 * Written for the person about to run a bulk rebuild: the failure mode this
 * module addresses looked like silence, so the affordance has to say the
 * number out loud.
 */
export function describeBudget(b: GenerationBudget): string {
  if (b.exhausted) {
    return `Daily generation budget exhausted (${b.generationsUsed}/${DAILY_GENERATION_CAP} generations, ${b.tokensUsed}/${DAILY_TOKEN_CAP} tokens, ${b.counselRunsUsed}/${COUNSEL_DAILY_RUN_CAP} counsel runs). Rebuilds enqueued now will fail without generating. Resets at 00:00 UTC.`;
  }
  return `Budget remaining: ~${b.remaining} generation${b.remaining === 1 ? "" : "s"} (used ${b.generationsUsed}/${DAILY_GENERATION_CAP} generations, ${b.tokensUsed}/${DAILY_TOKEN_CAP} tokens, ${b.counselRunsUsed}/${COUNSEL_DAILY_RUN_CAP} counsel runs; ${b.bindingLimit} is the binding limit).`;
}

/**
 * Trim a candidate list to what the shop can actually afford today.
 *
 * Returns the batch to run plus the ones deferred, so a caller can REPORT the
 * deferral rather than silently truncating — a silent cap is how a partial run
 * reads as a complete one.
 */
export function fitBatchToBudget<T>(
  candidates: readonly T[],
  budget: GenerationBudget,
): { batch: T[]; deferred: T[] } {
  if (budget.exhausted) return { batch: [], deferred: [...candidates] };
  return {
    batch: candidates.slice(0, budget.remaining),
    deferred: candidates.slice(budget.remaining),
  };
}
