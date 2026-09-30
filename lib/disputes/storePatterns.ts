/**
 * Store patterns for the decided view — plan `docs/plans/decided-dispute-view.plan.md`
 * PR 3 ("Phase 2" of `lost-dispute-explanation.plan.md` §8).
 *
 * Aggregates over the shop's OWN decided disputes of the same type and phase,
 * pre-install history included (orders are linked for 100% of it). Two numbers:
 *
 *   baseRate — how often disputes of this type were won on this store.
 *   pattern  — how many lost disputes of this type share the lesson the
 *              current case teaches (order not shipped when the customer
 *              disputed; high-risk order shipped anyway).
 *
 * Guardrails, all load-bearing (plan §3 of the earlier plan):
 *   - Aggregates only. The copy never says this case was lost BECAUSE of a
 *     rate; a pattern line only sits under a recommendation the case itself
 *     already triggered.
 *   - Never built on `delivery_status` — its correlation runs backwards.
 *   - Small samples render nothing (MIN_* below). A missing number is honest;
 *     "1 of 1" is not a pattern.
 *
 * Pure. `loadStorePatternRows` in `loadDecidedResponse.ts` reads the rows.
 */

import { resolveReasonFamily, type ReasonFamily } from "@/lib/argument/reasonFamily";

/** Decided disputes of this type needed before a win rate is shown. */
export const MIN_BASE_RATE_DECIDED = 10;
/** Lost disputes of this type needed before a pattern count is shown. */
export const MIN_PATTERN_LOST = 5;
/** Matching lost disputes needed — below this it is just this case. */
export const MIN_PATTERN_MATCHES = 2;

export type StorePatternKind = "unshipped_at_open" | "high_risk_shipped";

export interface StorePatternRow {
  reason: string | null;
  phase: "inquiry" | "chargeback";
  outcome: "won" | "lost";
  openedAt: string | null;
  /** The linked order, or null when the dispute has none on record. */
  order: {
    fulfillmentStatus: string | null;
    fulfilledAt: string | null;
    riskRecommendation: string | null;
  } | null;
}

export interface StorePatterns {
  baseRate: { won: number; decided: number } | null;
  patterns: Partial<Record<StorePatternKind, { count: number; lost: number }>>;
}

const SHIPPED_STATUSES = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);
const HIGH_RISK = new Set(["CANCEL", "INVESTIGATE"]);

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? n : null;
}

/** Not shipped when the customer disputed: never shipped, or first shipped after. */
export function unshippedAtOpen(row: StorePatternRow): boolean | null {
  const o = row.order;
  if (!o) return null;
  const shipped = ms(o.fulfilledAt);
  if (shipped === null) {
    // A shipped status with no timestamp is an ingest gap, not "never shipped".
    return SHIPPED_STATUSES.has((o.fulfillmentStatus ?? "").toUpperCase()) ? null : true;
  }
  const opened = ms(row.openedAt);
  return opened !== null && shipped > opened;
}

/** Shopify recommended cancelling or investigating, and the order shipped. */
export function highRiskShipped(row: StorePatternRow): boolean | null {
  const o = row.order;
  if (!o) return null;
  return HIGH_RISK.has((o.riskRecommendation ?? "").toUpperCase()) && ms(o.fulfilledAt) !== null;
}

const PATTERN_TEST: Record<StorePatternKind, (row: StorePatternRow) => boolean | null> = {
  unshipped_at_open: unshippedAtOpen,
  high_risk_shipped: highRiskShipped,
};

/** Which patterns a family can carry — each matches a "Next time" rule. */
const FAMILY_PATTERNS: Partial<Record<ReasonFamily, StorePatternKind[]>> = {
  delivery: ["unshipped_at_open"],
  fraud: ["high_risk_shipped"],
};

export function computeStorePatterns(
  rows: StorePatternRow[],
  current: { reason: string | null; phase: "inquiry" | "chargeback" },
): StorePatterns {
  const family = resolveReasonFamily(current.reason);
  const same = rows.filter((r) => r.phase === current.phase && resolveReasonFamily(r.reason) === family);

  const won = same.filter((r) => r.outcome === "won").length;
  const baseRate = same.length >= MIN_BASE_RATE_DECIDED ? { won, decided: same.length } : null;

  const patterns: StorePatterns["patterns"] = {};
  const lost = same.filter((r) => r.outcome === "lost");
  for (const kind of FAMILY_PATTERNS[family] ?? []) {
    // Only disputes whose order we can read count, in either direction.
    const judged = lost.map(PATTERN_TEST[kind]).filter((v): v is boolean => v !== null);
    const count = judged.filter(Boolean).length;
    if (judged.length >= MIN_PATTERN_LOST && count >= MIN_PATTERN_MATCHES) {
      patterns[kind] = { count, lost: judged.length };
    }
  }
  return { baseRate, patterns };
}
