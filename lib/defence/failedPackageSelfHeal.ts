/**
 * Retry a defence package that failed on an INFRASTRUCTURE error, once the
 * cause has had time to clear. Daily, bounded, transient codes only.
 *
 * ── THE GAP ───────────────────────────────────────────────────────────
 *
 * Cay #14784 (PRODUCT_NOT_RECEIVED, due 2026-10-01) failed twice on
 * 2026-09-24 with `llm_error` — the Anthropic API refused a request carrying
 * five `cache_control` blocks. The fix (PR #798) shipped to prod on 09-26.
 * Nothing retried the case: `evaluateGenerationGuard` would have ALLOWED a
 * retry (an `llm_error` row records no `prompt_version`, which the guard reads
 * as "moved"), but the guard only answers when something ASKS, and the only
 * askers are `build_pack` completions — which run when evidence moves
 * (`refresh-open-disputes`), when a merchant clicks, or on the due day itself
 * (the deadline rebuild's window). The case sat on a failed latest package for
 * four days and was rebuilt by hand on 09-28. Three Mein Maison cases were in
 * the same state the same day.
 *
 * `daily_cap_reached` is the same shape: the cap resets at 00:00 UTC, and
 * nothing re-asks after it does (`project_llm_cap_defence_package_incident`).
 *
 * ── WHAT THIS RETRIES, AND WHAT IT NEVER DOES ─────────────────────────
 *
 * Only `llm_error` and `daily_cap_reached` — failures of the pipe, not of the
 * letter. `validation_failed` is a verdict ON the letter: regenerating it under
 * the same rules produces the same rejection and spends an LLM call each time
 * (the 2026-08-11 loop, and the standing rule that a rejected generation is
 * never retried automatically). Those stay with the version-change path in
 * `evaluateGenerationGuard` and with a human. `pdf_render_failed` is excluded
 * too: a renderer defect is deterministic until code changes.
 *
 * ── THE BOUNDS ────────────────────────────────────────────────────────
 *
 *   - Rate: called once a day, from the 06:00 UTC deadline-rebuild cron, so a
 *     case gets at most one self-heal attempt per day — and after the cap
 *     reset.
 *   - Streak: when the newest `MAX_TRANSIENT_STREAK` versions are ALL transient
 *     failures, stop. The cause is not clearing; a person has to look. A
 *     retry that fails writes a new failed row, so the streak counts every
 *     failed attempt from any trigger — the bound cannot be reset by the
 *     sweep's own work.
 *   - Settle: the failure must be at least `MIN_FAILURE_AGE_MS` old, so the
 *     sweep never races a build that is still being retried by its job.
 *   - Budget: a shop whose daily generation budget is spent is skipped — the
 *     retry would fail on the cap and lengthen the streak for nothing.
 *   - Run cap: at most `SELF_HEAL_RUN_CAP` enqueues per run, nearest deadline
 *     first.
 *   - Idempotent: the enqueue goes through `maybeEnqueueDefencePackage`, the
 *     one owner of versioning. A second call before the build runs finds the
 *     fresh draft and returns `idempotent_match`.
 *
 * It never rewrites or deletes a failed row. The failed version stays in the
 * history; the retry is a new version above it, exactly as a merchant's
 * Regenerate would be.
 */

import type { getServiceClient } from "@/lib/supabase/server";
import { maybeEnqueueDefencePackage } from "./enqueue";
import { readGenerationBudget } from "./generationBudget";
import { logAuditEvent } from "@/lib/audit/logEvent";
import type { DefencePackageFailureCode } from "./types";

/** Failures of the pipe, not of the letter. Never add `validation_failed`. */
export const TRANSIENT_FAILURE_CODES: readonly DefencePackageFailureCode[] = [
  "llm_error",
  "daily_cap_reached",
];

/** Consecutive transient failures after which the sweep stops and a human looks. */
export const MAX_TRANSIENT_STREAK = 3;

/** A failure younger than this is left alone. */
export const MIN_FAILURE_AGE_MS = 60 * 60 * 1000;

/** Enqueues per run. */
export const SELF_HEAL_RUN_CAP = 20;

/** How far back to look for failed rows. Older failures on still-open
 *  disputes are rare and should be looked at by a person. */
const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export interface PackageVersionRow {
  id: string;
  version: number;
  status: string | null;
  failure_code: string | null;
  updated_at: string | null;
}

export type SelfHealSkipReason =
  | "no_packages"
  | "latest_not_failed"
  | "failure_not_transient"
  | "too_recent"
  | "streak_exhausted";

export type SelfHealDecision =
  | { retry: true; failedPackageId: string; failureCode: string; streak: number }
  | { retry: false; reason: SelfHealSkipReason; streak: number };

function isTransientFailure(r: PackageVersionRow): boolean {
  return (
    r.status === "failed" &&
    typeof r.failure_code === "string" &&
    (TRANSIENT_FAILURE_CODES as readonly string[]).includes(r.failure_code)
  );
}

/**
 * The single predicate. `versions` is the dispute's newest packages, newest
 * first — at least `MAX_TRANSIENT_STREAK` of them when that many exist.
 */
export function decideSelfHeal(
  versions: readonly PackageVersionRow[],
  now: Date,
): SelfHealDecision {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const latest = sorted[0];
  if (!latest) return { retry: false, reason: "no_packages", streak: 0 };

  let streak = 0;
  for (const r of sorted) {
    if (!isTransientFailure(r)) break;
    streak += 1;
  }

  if (latest.status !== "failed") return { retry: false, reason: "latest_not_failed", streak };
  if (!isTransientFailure(latest)) {
    return { retry: false, reason: "failure_not_transient", streak };
  }
  if (streak >= MAX_TRANSIENT_STREAK) {
    return { retry: false, reason: "streak_exhausted", streak };
  }
  const failedAt = latest.updated_at ? Date.parse(latest.updated_at) : NaN;
  if (!Number.isFinite(failedAt) || now.getTime() - failedAt < MIN_FAILURE_AGE_MS) {
    return { retry: false, reason: "too_recent", streak };
  }
  return {
    retry: true,
    failedPackageId: latest.id,
    failureCode: latest.failure_code as string,
    streak,
  };
}

export interface SelfHealSummary {
  candidates: number;
  enqueued: number;
  skippedByReason: Record<string, number>;
  /** Disputes the sweep stopped on — each needs a person. */
  streakExhausted: string[];
  deferredBudget: number;
  deferredRunCap: number;
  errors: Array<{ disputeId: string; error: string }>;
}

type Sb = ReturnType<typeof getServiceClient>;

/**
 * Find open, unfiled disputes whose latest package failed transiently, and
 * re-ask `maybeEnqueueDefencePackage` for each.
 *
 * `excludeDisputeIds`: disputes the caller has just enqueued a `build_pack`
 * for. That build chains the same enqueue, so asking here too would race it.
 */
export async function runFailedPackageSelfHeal(
  sb: Sb,
  now: Date,
  excludeDisputeIds: ReadonlySet<string> = new Set(),
): Promise<SelfHealSummary> {
  const summary: SelfHealSummary = {
    candidates: 0,
    enqueued: 0,
    skippedByReason: {},
    streakExhausted: [],
    deferredBudget: 0,
    deferredRunCap: 0,
    errors: [],
  };
  const skip = (reason: string) => {
    summary.skippedByReason[reason] = (summary.skippedByReason[reason] ?? 0) + 1;
  };

  const { data: failedRows, error: failedErr } = await sb
    .from("defence_packages")
    .select("dispute_id")
    .eq("status", "failed")
    .in("failure_code", TRANSIENT_FAILURE_CODES as string[])
    .gte("updated_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .limit(1000);
  if (failedErr) throw new Error(`self-heal: failed-row query: ${failedErr.message}`);

  const disputeIds = [
    ...new Set((failedRows ?? []).map((r) => r.dispute_id as string)),
  ].filter((id) => !excludeDisputeIds.has(id));
  if (disputeIds.length === 0) return summary;

  const { data: disputes, error: dErr } = await sb
    .from("disputes")
    .select("id, shop_id, due_at")
    .in("id", disputeIds)
    .is("closed_at", null)
    .is("final_outcome", null)
    .is("evidence_saved_to_shopify_at", null)
    .gt("due_at", now.toISOString())
    .order("due_at", { ascending: true });
  if (dErr) throw new Error(`self-heal: dispute query: ${dErr.message}`);

  summary.candidates = disputes?.length ?? 0;
  const budgetExhausted = new Map<string, boolean>();

  for (const d of disputes ?? []) {
    const disputeId = d.id as string;
    const shopId = d.shop_id as string;
    try {
      const { data: versions } = await sb
        .from("defence_packages")
        .select("id, version, status, failure_code, updated_at")
        .eq("dispute_id", disputeId)
        .order("version", { ascending: false })
        .limit(MAX_TRANSIENT_STREAK);

      const decision = decideSelfHeal((versions ?? []) as PackageVersionRow[], now);
      if (!decision.retry) {
        skip(decision.reason);
        if (decision.reason === "streak_exhausted") summary.streakExhausted.push(disputeId);
        continue;
      }

      if (summary.enqueued >= SELF_HEAL_RUN_CAP) {
        summary.deferredRunCap += 1;
        continue;
      }

      if (!budgetExhausted.has(shopId)) {
        budgetExhausted.set(shopId, (await readGenerationBudget(shopId)).exhausted);
      }
      if (budgetExhausted.get(shopId)) {
        summary.deferredBudget += 1;
        continue;
      }

      const { data: pack } = await sb
        .from("evidence_packs")
        .select("id")
        .eq("dispute_id", disputeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!pack) {
        skip("no_pack");
        continue;
      }

      const result = await maybeEnqueueDefencePackage(pack.id as string);
      if (!result.enqueued) {
        skip(`enqueue_${result.reason}`);
        continue;
      }
      summary.enqueued += 1;
      await logAuditEvent({
        shopId,
        disputeId,
        packId: pack.id as string,
        actorType: "system",
        eventType: "auto_build_enqueued",
        eventPayload: {
          trigger: "failed_package_self_heal",
          failedPackageId: decision.failedPackageId,
          failureCode: decision.failureCode,
          transientStreak: decision.streak,
          newPackageId: result.packageId,
          newVersion: result.version,
          dueAt: d.due_at,
        },
      });
    } catch (err) {
      summary.errors.push({
        disputeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
