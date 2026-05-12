/**
 * Dispute-activity gatherer for the monthly digest.
 *
 * Pulls real dispute counts, outcomes, and win-rate trend from the
 * `disputes` table for a given shop + window. Pure data — no
 * rendering. Shared between the Vercel cron and the dev trigger
 * script.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DisputeActivityByReason {
  reason: string;
  count: number;
}

export interface DisputeOutcomeCounts {
  won: number;
  lost: number;
  partiallyWon: number;
  accepted: number;
  refunded: number;
  other: number;
}

export interface DisputeActivity {
  /** Count of disputes initiated in the current window. */
  openedCount: number;
  /** Total $ amount of disputes opened in the current window. */
  openedAmountTotal: number;
  /** Currency string for the opened total (assumes single-currency
   *  shop; fall back to the most common). */
  openedCurrency: string | null;
  /** Top reasons among opened disputes, sorted by count desc. */
  openedTopReasons: DisputeActivityByReason[];

  /** Count of disputes that reached a terminal `closed_at` in the
   *  current window. */
  closedCount: number;
  /** Total $ recovered across the closed batch (won + partial). */
  closedAmountRecovered: number;
  closedCurrency: string | null;
  closedOutcomes: DisputeOutcomeCounts;

  /** Count of disputes currently open (no closed_at, status open
   *  /needs_response). */
  openNowCount: number;
  /** Total $ at stake across the open queue. */
  openNowAmountAtStake: number;
  openNowCurrency: string | null;
  /** ISO timestamp of the nearest deadline across the open queue.
   *  Past dates are kept (and surfaced as "overdue"). */
  openNowNearestDueAt: string | null;

  /** Win rate over the trailing 90d window. `null` when too few
   *  decided disputes (<3) to be statistically meaningful. */
  winRate90dPct: number | null;
  /** Win rate over the 90d window before that, for the delta pill. */
  winRatePrior90dPct: number | null;
  decidedCount90d: number;
}

const DECIDED_OUTCOMES = new Set(["won", "lost", "partially_won"]);
const RECOVERED_OUTCOMES = new Set(["won", "partially_won"]);

function classifyOutcome(outcome: string | null): keyof DisputeOutcomeCounts {
  switch (outcome) {
    case "won":
      return "won";
    case "lost":
      return "lost";
    case "partially_won":
      return "partiallyWon";
    case "accepted":
      return "accepted";
    case "refunded":
      return "refunded";
    default:
      return "other";
  }
}

/**
 * Gather dispute activity for `shopId`, anchored on `anchor` (the
 * "now" of the digest). Windows:
 *   - Current 30d ending at `anchor`
 *   - Trailing 90d ending at `anchor`
 *   - Prior 90d (90d–180d before `anchor`)
 *
 * All count/amount fields default to zero, never null. Currency is
 * the most-common code in the relevant batch (or null if empty).
 */
export async function gatherDisputeActivity(
  sb: SupabaseClient,
  shopId: string,
  anchor: Date,
): Promise<DisputeActivity> {
  const w30 = new Date(anchor);
  w30.setUTCDate(anchor.getUTCDate() - 30);
  const w90 = new Date(anchor);
  w90.setUTCDate(anchor.getUTCDate() - 90);
  const w180 = new Date(anchor);
  w180.setUTCDate(anchor.getUTCDate() - 180);

  // ── Opened in 30d ────────────────────────────────────────────
  const { data: opened } = await sb
    .from("disputes")
    .select("id, reason, amount, currency_code, initiated_at")
    .eq("shop_id", shopId)
    .gte("initiated_at", w30.toISOString())
    .lt("initiated_at", anchor.toISOString());

  const openedRows = (opened ?? []) as Array<{
    reason: string | null;
    amount: number | null;
    currency_code: string | null;
  }>;

  const reasonCounts = new Map<string, number>();
  let openedAmountTotal = 0;
  const currencyTally = new Map<string, number>();
  for (const d of openedRows) {
    if (d.reason) {
      reasonCounts.set(d.reason, (reasonCounts.get(d.reason) ?? 0) + 1);
    }
    if (typeof d.amount === "number") openedAmountTotal += d.amount;
    if (d.currency_code) {
      currencyTally.set(
        d.currency_code,
        (currencyTally.get(d.currency_code) ?? 0) + 1,
      );
    }
  }
  const openedTopReasons: DisputeActivityByReason[] = Array.from(
    reasonCounts.entries(),
  )
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);

  // ── Closed in 30d ────────────────────────────────────────────
  const { data: closed } = await sb
    .from("disputes")
    .select(
      "id, final_outcome, outcome_amount_recovered, amount, currency_code, closed_at",
    )
    .eq("shop_id", shopId)
    .gte("closed_at", w30.toISOString())
    .lt("closed_at", anchor.toISOString());

  const closedRows = (closed ?? []) as Array<{
    final_outcome: string | null;
    outcome_amount_recovered: number | null;
    amount: number | null;
    currency_code: string | null;
  }>;

  const outcomes: DisputeOutcomeCounts = {
    won: 0,
    lost: 0,
    partiallyWon: 0,
    accepted: 0,
    refunded: 0,
    other: 0,
  };
  let closedAmountRecovered = 0;
  const closedCurrencyTally = new Map<string, number>();
  for (const d of closedRows) {
    const cls = classifyOutcome(d.final_outcome);
    outcomes[cls] += 1;
    if (
      RECOVERED_OUTCOMES.has(d.final_outcome ?? "") &&
      typeof d.outcome_amount_recovered === "number"
    ) {
      closedAmountRecovered += d.outcome_amount_recovered;
    } else if (
      d.final_outcome === "won" &&
      typeof d.amount === "number" &&
      d.outcome_amount_recovered == null
    ) {
      // Fall back to the original dispute amount when recovered isn't
      // populated — common for older rows.
      closedAmountRecovered += d.amount;
    }
    if (d.currency_code) {
      closedCurrencyTally.set(
        d.currency_code,
        (closedCurrencyTally.get(d.currency_code) ?? 0) + 1,
      );
    }
  }

  // ── Open right now ───────────────────────────────────────────
  // Currently-active queue: anything without a closed_at marker.
  // `status` may still read `needs_response` in Shopify even after
  // submission; `closed_at` is the unambiguous "settled" signal.
  const { data: openNow } = await sb
    .from("disputes")
    .select("id, due_at, amount, currency_code")
    .eq("shop_id", shopId)
    .is("closed_at", null)
    .order("due_at", { ascending: true, nullsFirst: false });

  const openNowRows = (openNow ?? []) as Array<{
    due_at: string | null;
    amount: number | null;
    currency_code: string | null;
  }>;

  let openNowAmountAtStake = 0;
  const openCurrencyTally = new Map<string, number>();
  for (const d of openNowRows) {
    if (typeof d.amount === "number") openNowAmountAtStake += d.amount;
    if (d.currency_code) {
      openCurrencyTally.set(
        d.currency_code,
        (openCurrencyTally.get(d.currency_code) ?? 0) + 1,
      );
    }
  }
  const openNowNearestDueAt =
    openNowRows.find((d) => d.due_at != null)?.due_at ?? null;

  // ── Win rate 90d (current + prior) ──────────────────────────
  async function winRate(start: Date, end: Date): Promise<{
    rate: number | null;
    decided: number;
  }> {
    const { data } = await sb
      .from("disputes")
      .select("final_outcome")
      .eq("shop_id", shopId)
      .gte("closed_at", start.toISOString())
      .lt("closed_at", end.toISOString());
    const rows = (data ?? []) as Array<{ final_outcome: string | null }>;
    const decided = rows.filter((r) =>
      DECIDED_OUTCOMES.has(r.final_outcome ?? ""),
    );
    if (decided.length < 3) return { rate: null, decided: decided.length };
    const won = decided.filter((r) => r.final_outcome === "won").length;
    return { rate: (won / decided.length) * 100, decided: decided.length };
  }
  const cur90 = await winRate(w90, anchor);
  const prior90 = await winRate(w180, w90);

  function topCurrency(tally: Map<string, number>): string | null {
    let best: [string, number] | null = null;
    for (const e of tally.entries()) {
      if (!best || e[1] > best[1]) best = e;
    }
    return best?.[0] ?? null;
  }

  return {
    openedCount: openedRows.length,
    openedAmountTotal,
    openedCurrency: topCurrency(currencyTally),
    openedTopReasons,
    closedCount: closedRows.length,
    closedAmountRecovered,
    closedCurrency: topCurrency(closedCurrencyTally),
    closedOutcomes: outcomes,
    openNowCount: openNowRows.length,
    openNowAmountAtStake,
    openNowCurrency: topCurrency(openCurrencyTally),
    openNowNearestDueAt,
    winRate90dPct: cur90.rate,
    winRatePrior90dPct: prior90.rate,
    decidedCount90d: cur90.decided,
  };
}
