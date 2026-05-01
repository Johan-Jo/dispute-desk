/**
 * Per-shop risk profile composition for the admin merchant detail
 * surface (`/admin/shops/[id]` Risk profile section).
 *
 * Reads:
 *   - `shop_daily_metrics` (chargeback rate 30d/90d, total orders,
 *     weekly trend, sync freshness)
 *   - `disputes` (total disputes, reason mix, outcome mix, amount
 *     at risk, inquiry vs chargeback)
 *
 * Never queries Shopify live (PRD §6, §12). When snapshot rows are
 * missing the response surfaces `available: false` for the
 * corresponding window so the UI renders a loading/empty state
 * instead of zeroes.
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  computeChargebackRate,
  defaultWindowEndDate,
  windowStartDate,
  type ChargebackRateResult,
} from "@/lib/disputes/chargebackRate";
import {
  DISPUTE_REASON_FAMILIES,
  type AllDisputeReasonCode,
} from "@/lib/rules/disputeReasons";

export interface ShopRiskProfile {
  shopId: string;
  /** Chargeback rate over the trailing 30 UTC days. */
  rate30d: ChargebackRateResult;
  /** Chargeback rate over the trailing 90 UTC days. */
  rate90d: ChargebackRateResult;
  /** Disputes initiated in the trailing 90 days, all phases. */
  totalDisputes90d: number;
  /** Order count snapshotted in the trailing 90 days. */
  totalOrders90d: number;
  /** Sum of `amount` for disputes whose normalized_status is active. */
  amountAtRisk: number;
  /** Currency for amountAtRisk — picks the most common currency_code
   *  across the dispute set. */
  currencyCode: string;
  /** Reason mix in the trailing 90 days, grouped per PRD §9. */
  reasonBreakdown: {
    fraud: number;
    fulfillment: number; // "Item not received" + "Quality"
    other: number;
  };
  /** Outcome mix across all disputes initiated in the trailing 90
   *  days. `pending` = open / no terminal outcome yet. */
  outcomeBreakdown: {
    won: number;
    lost: number;
    pending: number;
  };
  /** Inquiry-to-chargeback ratio (PRD §9). */
  inquiryCount90d: number;
  chargebackCount90d: number;
  /** Weekly dispute counts over the trailing 90 days. 13 buckets,
   *  oldest-first. Used by the admin sparkline. */
  weeklyTrend: Array<{ weekStart: string; disputeCount: number }>;
  /** Most recent snapshot `last_synced_at` across the 90d window —
   *  drives the sync freshness signal. */
  lastSyncedAt: string | null;
}

const FRAUD_FAMILIES = new Set(["Fraud", "Authorization"]);
const FULFILLMENT_FAMILIES = new Set(["Fulfillment", "Quality"]);

function classifyReasonFamily(
  reason: string | null | undefined,
): "fraud" | "fulfillment" | "other" {
  if (!reason) return "other";
  const code = reason.toUpperCase().replace(/\s+/g, "_") as AllDisputeReasonCode;
  const family = DISPUTE_REASON_FAMILIES[code];
  if (!family) return "other";
  if (FRAUD_FAMILIES.has(family)) return "fraud";
  if (FULFILLMENT_FAMILIES.has(family)) return "fulfillment";
  return "other";
}

/** UTC Monday on or before `dateIso`. */
function utcWeekStart(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  const day = d.getUTCDay(); // 0 = Sun
  const offset = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

const ACTIVE_NORMALIZED = new Set([
  "new", "in_progress", "needs_review", "ready_to_submit",
  "action_needed", "submitted", "submitted_to_shopify",
  "waiting_on_issuer", "submitted_to_bank",
]);

export async function getShopRiskProfile(shopId: string): Promise<ShopRiskProfile> {
  const sb = getServiceClient();
  const today = new Date();
  const toDate = defaultWindowEndDate(today);
  const from30 = windowStartDate(toDate, 30);
  const from90 = windowStartDate(toDate, 90);

  // Two parallel snapshot reads.
  const [rate30d, rate90d] = await Promise.all([
    computeChargebackRate({ shopId, fromDate: from30, toDate }),
    computeChargebackRate({ shopId, fromDate: from90, toDate }),
  ]);

  // Disputes initiated in trailing 90 days. We pull the columns we
  // need for the breakdown computations rather than three separate
  // count() queries — the table is per-shop and 90d-windowed, so the
  // row set stays small.
  const ninetyDaysAgoIso = `${from90}T00:00:00Z`;
  const { data: dispRows } = await sb
    .from("disputes")
    .select("id, amount, currency_code, reason, phase, final_outcome, normalized_status, initiated_at")
    .eq("shop_id", shopId)
    .gte("initiated_at", ninetyDaysAgoIso);
  const disputes = (dispRows ?? []) as Array<Record<string, unknown>>;

  const reasonBreakdown = { fraud: 0, fulfillment: 0, other: 0 };
  const outcomeBreakdown = { won: 0, lost: 0, pending: 0 };
  let inquiryCount = 0;
  let chargebackCount = 0;
  let amountAtRisk = 0;
  const currencyCounts: Record<string, number> = {};

  for (const d of disputes) {
    // Reason
    const fam = classifyReasonFamily(d.reason as string | null | undefined);
    reasonBreakdown[fam] += 1;

    // Outcome
    const outcome = String(d.final_outcome ?? "");
    if (outcome === "won") outcomeBreakdown.won += 1;
    else if (outcome === "lost") outcomeBreakdown.lost += 1;
    else outcomeBreakdown.pending += 1;

    // Phase
    if (d.phase === "inquiry") inquiryCount += 1;
    else if (d.phase === "chargeback") chargebackCount += 1;

    // Amount at risk: only active disputes (no terminal outcome)
    const ns = String(d.normalized_status ?? "new");
    if (ACTIVE_NORMALIZED.has(ns)) {
      amountAtRisk += Number(d.amount) || 0;
    }

    // Currency tally
    const c = String(d.currency_code ?? "USD");
    currencyCounts[c] = (currencyCounts[c] ?? 0) + 1;
  }

  const currencyCode =
    Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  // Weekly trend — bucket disputes by their UTC week start. We render
  // 13 weeks (last 91 days, rounded). Empty weeks are still emitted
  // so the sparkline x-axis is uniform.
  const weeklyMap = new Map<string, number>();
  // Pre-seed all weeks in the window with 0 so the trend renders even
  // if the shop has zero disputes recently.
  {
    const start = new Date(`${from90}T00:00:00Z`);
    for (let i = 0; i <= 13; i++) {
      const wk = new Date(start);
      wk.setUTCDate(wk.getUTCDate() + i * 7);
      weeklyMap.set(utcWeekStart(wk.toISOString().slice(0, 10)), 0);
    }
  }
  for (const d of disputes) {
    const initiated = String(d.initiated_at ?? "");
    if (!initiated) continue;
    const dateIso = initiated.slice(0, 10);
    if (dateIso < from90 || dateIso > toDate) continue;
    const wk = utcWeekStart(dateIso);
    weeklyMap.set(wk, (weeklyMap.get(wk) ?? 0) + 1);
  }
  const weeklyTrend = Array.from(weeklyMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekStart, disputeCount]) => ({ weekStart, disputeCount }));

  return {
    shopId,
    rate30d,
    rate90d,
    totalDisputes90d: disputes.length,
    totalOrders90d: rate90d.denominator,
    amountAtRisk,
    currencyCode,
    reasonBreakdown,
    outcomeBreakdown,
    inquiryCount90d: inquiryCount,
    chargebackCount90d: chargebackCount,
    weeklyTrend,
    lastSyncedAt: rate90d.lastSyncedAt,
  };
}
