/**
 * Shared dispute metrics query layer.
 *
 * Single source of truth for dispute aggregation. Used by:
 * - GET /api/dashboard/stats (shop-scoped, merchant view)
 * - GET /api/admin/metrics (cross-shop, admin view)
 *
 * All queries use the normalized dispute fields from Phase 1.
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  computeChargebackRate,
  defaultWindowEndDate,
  windowStartDate,
} from "./chargebackRate";

export interface MetricsOptions {
  /** Shop ID for shop-scoped metrics. Omit for cross-shop (admin). */
  shopId?: string;
  /** Period start (ISO). Omit for all-time. */
  periodFrom?: string;
  /** Period end (ISO). Defaults to now. */
  periodTo?: string;
  /** ISO-4217 currency code to prefer as the display currency for
   *  the Recovered / Lost / At Risk tiles. Typically the shop's
   *  Shopify presentment currency (`shops.currency_code`). When
   *  supplied AND at least one dispute in the window is denominated
   *  in this currency, the metrics layer uses it instead of the
   *  most-frequent-currency heuristic. When supplied but no matching
   *  dispute exists (e.g. shop is USD but every chargeback is EUR),
   *  the heuristic still wins — showing "$0 recovered" when the
   *  merchant has €9k in plays is worse than showing the wrong
   *  symbol. */
  preferredCurrency?: string | null;
}

export interface DisputeMetrics {
  // Counts
  activeDisputes: number;
  disputesWon: number;
  disputesLost: number;
  totalClosed: number;

  // Financials. All amount sums are scoped to disputes whose
  // `currency_code === currencyCode` (the most-frequent currency in the
  // window). Cross-currency sums would be meaningless ($100 + €100 ≠
  // 200 of anything), so disputes in other currencies are excluded
  // from these totals and surfaced via `otherCurrencyCounts` so the UI
  // can hint at the omission.
  amountAtRisk: number;
  amountRecovered: number;
  amountLost: number;
  recoveryRate: number;
  currencyCode: string;
  /** Counts of disputes in the window that are denominated in
   *  currencies OTHER than `currencyCode`. Empty object when all
   *  disputes share the primary currency. UI uses this to render a
   *  "+ N in EUR, M in SEK" hint under currency tiles so merchants
   *  know the headline numbers don't cover every dispute. */
  otherCurrencyCounts: Record<string, number>;

  // Rates
  winRate: number;

  // Timing (days, null if no data)
  avgTimeToSubmit: number | null;
  avgTimeToClose: number | null;

  // Breakdowns
  statusBreakdown: Record<string, number>;
  outcomeBreakdown: Record<string, number>;

  // Phase
  inquiryCount: number;
  chargebackCount: number;
  needsAttentionCount: number;

  // Period-over-period (null when no comparison available)
  activeDisputesChange: number | null;
  winRateChange: number | null;
  amountAtRiskChange: number | null;
  disputesWonChange: number | null;
  amountRecoveredChange: number | null;

  // Admin-only (null when shop-scoped)
  overriddenCount: number | null;
  syncIssueCount: number | null;
  disputesWithNotesCount: number | null;

  // ── Chargeback rate (PRD §8) ─────────────────────────────────────────
  // Read from shop_daily_metrics, not raw disputes. `chargebackRate`
  // is null when the snapshot is missing for the window OR when there
  // are zero orders in the window — UI should render "—". Numerator
  // counts only `phase = 'chargeback'`; inquiries are excluded.
  chargebackRate: number | null;
  /** Percentage points vs. the prior equal-length window. Same unit
   *  convention as `winRateChange`. */
  chargebackRateChange: number | null;
  chargebackRateNumerator: number;
  chargebackRateDenominator: number;
  /** True when the window has at least one snapshot row. Distinguishes
   *  "not yet snapshotted" from "genuinely zero." */
  chargebackRateAvailable: boolean;
  /** True when denominator < 50 — UI should hint the rate may be
   *  volatile (PRD §11). */
  chargebackRateLowVolume: boolean;
  /** Most recent snapshot `last_synced_at` in the window — admin
   *  Sync Freshness signal (PRD §9). */
  chargebackRateLastSyncedAt: string | null;
}

const ACTIVE_NORMALIZED = [
  "new", "in_progress", "needs_review", "ready_to_submit",
  "action_needed", "submitted", "submitted_to_shopify",
  "waiting_on_issuer", "submitted_to_bank",
];

function pctChange(curr: number, prev: number | null): number | null {
  if (prev === null) return null;
  if (prev === 0) return curr > 0 ? 100 : 0;
  return Math.round(((curr - prev) / prev) * 100);
}

export async function computeDisputeMetrics(
  opts: MetricsOptions,
): Promise<DisputeMetrics> {
  const sb = getServiceClient();
  const { shopId, periodFrom, periodTo, preferredCurrency } = opts;
  const periodEnd = periodTo ?? new Date().toISOString();

  // ── Fetch ALL disputes for the shop (no created_at window) ────────────
  // The period selector no longer filters this query. `created_at` is the
  // DB insert timestamp, which for bulk-imported shops (first full sync of
  // an established shop) is a single day for the entire history — so a
  // created_at window either captures everything or nothing, and the KPI
  // tiles stop responding to the selector.
  //
  // Instead the period is applied per-metric with the field that actually
  // carries the intent:
  //   • Snapshot metrics (Active Disputes, Amount at Risk, status
  //     breakdown, needs-attention) — NOT windowed. "Open work right now"
  //     is a point-in-time fact; an active dispute is active regardless of
  //     when it started.
  //   • Outcome metrics (Win Rate, won/lost, Amount Recovered/Lost, Closed,
  //     outcome breakdown) — windowed by `closed_at` ∈ [periodFrom,
  //     periodEnd]. "Win rate in the last 30 days" means disputes DECIDED
  //     in that window.
  let q = sb
    .from("disputes")
    .select("id, status, amount, currency_code, phase, needs_review, normalized_status, final_outcome, submission_state, submitted_at, closed_at, initiated_at, outcome_amount_recovered, outcome_amount_lost, has_admin_override, sync_health, needs_attention, last_event_at");

  if (shopId) q = q.eq("shop_id", shopId);

  const { data } = await q;
  const list = (data ?? []) as Record<string, unknown>[];

  // Outcome window: disputes whose closed_at falls in [periodFrom,
  // periodEnd]. When periodFrom is omitted ("all time"), every closed
  // dispute up to periodEnd qualifies.
  const from = periodFrom ? new Date(periodFrom).getTime() : null;
  const to = new Date(periodEnd).getTime();
  const closedInWindow = (d: Record<string, unknown>): boolean => {
    if (d.closed_at == null) return false;
    const c = new Date(String(d.closed_at)).getTime();
    if (Number.isNaN(c)) return false;
    if (c > to) return false;
    if (from !== null && c < from) return false;
    return true;
  };
  // The outcome-scoped subset drives every "decided in period" metric.
  const outcomeList = list.filter(closedInWindow);

  // ── Fetch previous-window outcomes (for period-over-period) ───────────
  // Prior window is the equal-length span immediately before the current
  // one; comparison is outcome-based (won / recovered), so it also windows
  // by closed_at. Active/at-risk are snapshots and have no meaningful
  // prior-period delta, so those change fields become null (see below).
  let prevOutcomeList: Record<string, unknown>[] = [];
  if (periodFrom && from !== null) {
    const periodMs = to - from;
    const prevFrom = from - periodMs;
    prevOutcomeList = list.filter((d) => {
      if (d.closed_at == null) return false;
      const c = new Date(String(d.closed_at)).getTime();
      return !Number.isNaN(c) && c >= prevFrom && c < from;
    });
  }

  const closedInPeriodCount = outcomeList.length;

  // ── Currency (picked before amount sums so we can scope them) ─────────
  // The dashboard quotes a single currency symbol per tile. Mixing
  // currencies into one sum is wrong regardless of which symbol you
  // print, so we confine `amountAtRisk` / `amountRecovered` /
  // `amountLost` to one currency. Picking order:
  //
  //   1. `preferredCurrency` (the shop's Shopify presentment currency
  //      from `shops.currency_code`) — but only if at least one
  //      dispute in the window is denominated in it. Falling back
  //      avoids "$0 recovered" when the merchant has real plays in a
  //      different currency.
  //   2. Most-frequent `currency_code` in the window (legacy).
  //   3. `"USD"` (no disputes — empty dashboard).
  //
  // Disputes in other currencies count toward `otherCurrencyCounts`
  // so the UI can hint they exist without rolling them into the sum.
  const currencyCounts: Record<string, number> = {};
  for (const d of list) {
    const c = String(d.currency_code ?? "USD");
    currencyCounts[c] = (currencyCounts[c] ?? 0) + 1;
  }
  const mostFrequent = Object.entries(currencyCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const preferredHasMatches =
    preferredCurrency != null && (currencyCounts[preferredCurrency] ?? 0) > 0;
  // Special case: empty dispute set → honor the shop's preferred
  // currency so an empty dashboard still shows the right symbol.
  const currencyCode =
    preferredHasMatches
      ? preferredCurrency!
      : list.length === 0 && preferredCurrency
        ? preferredCurrency
        : mostFrequent;
  const otherCurrencyCounts: Record<string, number> = {};
  for (const [code, count] of Object.entries(currencyCounts)) {
    if (code !== currencyCode) otherCurrencyCounts[code] = count;
  }
  const inPrimaryCurrency = (d: Record<string, unknown>) =>
    String(d.currency_code ?? "USD") === currencyCode;

  // ── Active disputes ───────────────────────────────────────────────────
  const active = list.filter((d) =>
    ACTIVE_NORMALIZED.includes(String(d.normalized_status ?? "new")),
  );
  const activeDisputes = active.length;
  // amountAtRisk sums only active disputes in the primary currency.
  // Active dispute COUNT still spans all currencies — that's a unit-
  // less count, safe to aggregate.
  const amountAtRisk = active
    .filter(inPrimaryCurrency)
    .reduce((s, d) => s + (Number(d.amount) || 0), 0);

  // ── Win/Loss (final_outcome based, windowed by closed_at) ─────────────
  // Uses `outcomeList` (closed in period), not `list`, so "Win Rate"
  // reflects disputes DECIDED in the selected window and responds to the
  // period selector.
  const won = outcomeList.filter((d) => d.final_outcome === "won");
  const lost = outcomeList.filter((d) => d.final_outcome === "lost");
  const disputesWon = won.length;
  const disputesLost = lost.length;
  const winLossDenom = disputesWon + disputesLost;
  const winRate = winLossDenom > 0 ? Math.round((disputesWon / winLossDenom) * 100) : 0;

  // ── Financial outcomes (windowed by closed_at, primary currency) ──────
  const amountRecovered = outcomeList
    .filter(inPrimaryCurrency)
    .reduce((s, d) => s + (Number(d.outcome_amount_recovered) || 0), 0);
  const amountLost = outcomeList
    .filter(inPrimaryCurrency)
    .reduce((s, d) => s + (Number(d.outcome_amount_lost) || 0), 0);
  const financialTotal = amountRecovered + amountLost;
  const recoveryRate = financialTotal > 0
    ? Math.round((amountRecovered / financialTotal) * 100)
    : 0;

  // Closed in the selected window (by closed_at). Equal to
  // outcomeList.length by construction.
  const totalClosed = closedInPeriodCount;

  // ── Timing (scoped to disputes decided in the window) ─────────────────
  // Both timings describe completed cases, so they use `outcomeList`
  // (closed in period) and move with the selector like the other outcome
  // metrics.
  const submittedDisputes = outcomeList.filter(
    (d) => d.submitted_at && d.initiated_at,
  );
  const avgTimeToSubmit = submittedDisputes.length > 0
    ? submittedDisputes.reduce((s, d) => {
        const ms = new Date(String(d.submitted_at)).getTime() - new Date(String(d.initiated_at)).getTime();
        return s + Math.max(0, ms);
      }, 0) / submittedDisputes.length / (24 * 60 * 60 * 1000)
    : null;

  const closedDisputes = outcomeList.filter((d) => d.closed_at && d.initiated_at);
  const avgTimeToClose = closedDisputes.length > 0
    ? closedDisputes.reduce((s, d) => {
        const ms = new Date(String(d.closed_at)).getTime() - new Date(String(d.initiated_at)).getTime();
        return s + Math.max(0, ms);
      }, 0) / closedDisputes.length / (24 * 60 * 60 * 1000)
    : null;

  // ── Breakdowns ────────────────────────────────────────────────────────
  const statusBreakdown: Record<string, number> = {};
  for (const d of list) {
    const ns = String(d.normalized_status ?? "new");
    statusBreakdown[ns] = (statusBreakdown[ns] ?? 0) + 1;
  }

  // Outcome breakdown is a "decided in period" metric → windowed by
  // closed_at (outcomeList), matching Win Rate.
  const outcomeBreakdown: Record<string, number> = {};
  for (const d of outcomeList) {
    if (d.final_outcome) {
      const fo = String(d.final_outcome);
      outcomeBreakdown[fo] = (outcomeBreakdown[fo] ?? 0) + 1;
    }
  }

  // ── Phase counts ──────────────────────────────────────────────────────
  const inquiryCount = active.filter((d) => d.phase === "inquiry").length;
  const chargebackCount = active.filter((d) => d.phase !== "inquiry").length;
  const needsAttentionCount = list.filter((d) => d.needs_attention === true).length;

  // ── Period-over-period ────────────────────────────────────────────────
  // Only OUTCOME metrics have a meaningful prior-window delta, and the
  // prior window is also closed_at-scoped (via `prevOutcomeList`). Active
  // Disputes and Amount at Risk are point-in-time snapshots — there is no
  // "prior snapshot" to diff against without historical state we don't
  // keep — so their change fields are null. Prior AMOUNT sums use the same
  // primary-currency filter as the current window so the delta compares
  // like-with-like.
  const prevActiveCount: number | null = null; // snapshot metric, no delta
  const prevAmountAtRisk: number | null = null; // snapshot metric, no delta
  const prevWon = prevOutcomeList.filter((d) => d.final_outcome === "won").length;
  const prevLost = prevOutcomeList.filter((d) => d.final_outcome === "lost").length;
  const prevDenom = prevWon + prevLost;
  const prevWinRate = periodFrom && prevDenom > 0
    ? Math.round((prevWon / prevDenom) * 100)
    : periodFrom ? 0 : null;
  const prevRecovered = periodFrom
    ? prevOutcomeList
        .filter(inPrimaryCurrency)
        .reduce((s, d) => s + (Number(d.outcome_amount_recovered) || 0), 0)
    : null;

  // ── Admin-only metrics (cross-shop) ───────────────────────────────────
  let overriddenCount: number | null = null;
  let syncIssueCount: number | null = null;
  let disputesWithNotesCount: number | null = null;

  if (!shopId) {
    overriddenCount = list.filter((d) => d.has_admin_override === true).length;
    syncIssueCount = list.filter(
      (d) => d.sync_health !== "ok" || d.needs_attention === true,
    ).length;

    // Count disputes with notes (separate query)
    const { count: notesCount } = await sb
      .from("dispute_notes")
      .select("dispute_id", { count: "exact", head: true });
    disputesWithNotesCount = notesCount ?? 0;
  }

  // ── Chargeback rate (PRD §8) ──────────────────────────────────────────
  // Pulls from shop_daily_metrics. Shop-scoped only — cross-shop admin
  // metrics surface this differently (per-shop on the risk page, not
  // an aggregated platform rate). Window: when `periodFrom` is given,
  // map [periodFrom, periodTo) → [fromDate, toDate] in UTC days,
  // clamped at yesterday since today's snapshot isn't written yet.
  let chargebackRate: number | null = null;
  let chargebackRateChange: number | null = null;
  let chargebackRateNumerator = 0;
  let chargebackRateDenominator = 0;
  let chargebackRateAvailable = false;
  let chargebackRateLowVolume = false;
  let chargebackRateLastSyncedAt: string | null = null;

  if (shopId) {
    const toDate = defaultWindowEndDate(new Date(periodEnd));
    const fromDate = periodFrom
      ? toDateOnlyClamped(new Date(periodFrom), toDate)
      : windowStartDate(toDate, 30); // default to a 30d view (PRD §4)
    const cb = await computeChargebackRate({
      shopId,
      fromDate,
      toDate,
    });
    chargebackRate = cb.rate;
    chargebackRateChange = cb.rateChange;
    chargebackRateNumerator = cb.numerator;
    chargebackRateDenominator = cb.denominator;
    chargebackRateAvailable = cb.available;
    chargebackRateLowVolume = cb.lowVolume;
    chargebackRateLastSyncedAt = cb.lastSyncedAt;
  }

  return {
    activeDisputes,
    disputesWon,
    disputesLost,
    totalClosed,
    amountAtRisk,
    amountRecovered,
    amountLost,
    recoveryRate,
    currencyCode,
    otherCurrencyCounts,
    winRate,
    avgTimeToSubmit: avgTimeToSubmit !== null ? Math.round(avgTimeToSubmit * 10) / 10 : null,
    avgTimeToClose: avgTimeToClose !== null ? Math.round(avgTimeToClose * 10) / 10 : null,
    statusBreakdown,
    outcomeBreakdown,
    inquiryCount,
    chargebackCount,
    needsAttentionCount,
    activeDisputesChange: pctChange(activeDisputes, prevActiveCount),
    winRateChange: prevWinRate !== null ? winRate - prevWinRate : null,
    amountAtRiskChange: pctChange(amountAtRisk, prevAmountAtRisk),
    disputesWonChange: pctChange(disputesWon, periodFrom ? prevWon : null),
    amountRecoveredChange: pctChange(amountRecovered, prevRecovered),
    overriddenCount,
    syncIssueCount,
    disputesWithNotesCount,
    chargebackRate,
    chargebackRateChange,
    chargebackRateNumerator,
    chargebackRateDenominator,
    chargebackRateAvailable,
    chargebackRateLowVolume,
    chargebackRateLastSyncedAt,
  };
}

/** Convert a Date to YYYY-MM-DD UTC, clamped to not exceed `maxDate`
 *  (the snapshot upper bound, typically yesterday). */
function toDateOnlyClamped(d: Date, maxDate: string): string {
  const iso = d.toISOString().slice(0, 10);
  return iso > maxDate ? maxDate : iso;
}
