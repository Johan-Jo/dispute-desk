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
  /** Prompt tokens already spent in that bucket. */
  tokensUsed: number;
  /** Generations still affordable — the binding of the two limits. Never < 0. */
  remaining: number;
  /** True when nothing further can be generated today. */
  exhausted: boolean;
  /** Which limit binds. `null` when there is headroom. */
  bindingLimit: "generations" | "tokens" | null;
}

const UNKNOWN: GenerationBudget = {
  generationsUsed: 0,
  tokensUsed: 0,
  remaining: DAILY_GENERATION_CAP,
  exhausted: false,
  bindingLimit: null,
};

/**
 * Read the remaining budget for one shop.
 *
 * SOFT-FAILS OPEN, matching `checkDailyCap`. A failed count query must not
 * block a rebuild — `narrativeWriter` still enforces the real cap, so the
 * worst case of an optimistic read here is the behaviour we have today.
 */
export async function readGenerationBudget(shopId: string): Promise<GenerationBudget> {
  const sb = getServiceClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("defence_package_runs")
    .select("prompt_tokens")
    .eq("shop_id", shopId)
    .eq("daily_bucket", today);

  if (error) {
    console.warn("[defence] generation-budget query failed", error.message);
    return UNKNOWN;
  }

  const generationsUsed = data?.length ?? 0;
  const tokensUsed = (data ?? []).reduce(
    (sum, r) => sum + ((r as { prompt_tokens?: number | null }).prompt_tokens ?? 0),
    0,
  );

  const byGenerations = Math.max(0, DAILY_GENERATION_CAP - generationsUsed);
  const byTokens = Math.max(
    0,
    Math.floor((DAILY_TOKEN_CAP - tokensUsed) / ESTIMATED_TOKENS_PER_GENERATION),
  );
  const remaining = Math.min(byGenerations, byTokens);

  return {
    generationsUsed,
    tokensUsed,
    remaining,
    exhausted: remaining <= 0,
    bindingLimit: remaining <= 0 || byTokens < byGenerations ? "tokens" : "generations",
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
    return `Daily generation budget exhausted (${b.generationsUsed}/${DAILY_GENERATION_CAP} generations, ${b.tokensUsed}/${DAILY_TOKEN_CAP} tokens). Rebuilds enqueued now will fail without generating. Resets at 00:00 UTC.`;
  }
  return `Budget remaining: ~${b.remaining} generation${b.remaining === 1 ? "" : "s"} (used ${b.generationsUsed}/${DAILY_GENERATION_CAP} generations, ${b.tokensUsed}/${DAILY_TOKEN_CAP} tokens; ${b.bindingLimit} is the binding limit).`;
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
