/**
 * Per-shop risk profile composition for the admin merchant detail
 * surface (`/admin/shops/[id]` Risk profile section).
 *
 * Period-aware: the caller selects 30d / 90d / 180d / all-time and
 * the helper returns a single chargeback-rate value, period-scoped
 * dispute / order / outcome / reason breakdowns, period-vs-prior
 * trend deltas for total disputes and total orders, an approximate
 * "Total invoiced" figure, a Win rate, a data-completeness signal,
 * and a weekly trend series sized for the period.
 *
 * Reads:
 *   - `shop_daily_metrics` — chargeback rate, total orders, weekly
 *     trend orders series, sync freshness, data-completeness.
 *   - `disputes` — total disputes, reason mix, outcome mix, amount
 *     at risk, inquiry vs chargeback, weekly trend dispute series.
 *   - `shops.plan` (passed in from the API layer) — drives the
 *     monthly revenue / total-invoiced figures via shopBilling.
 *
 * Never queries Shopify live (PRD §6, §12).
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
import {
  monthlyRevenueForPlan,
  totalInvoicedForPeriod,
  type InvoicedAmount,
  type MonthlyRevenue,
} from "./shopBilling";

export type RiskPeriod = "30d" | "90d" | "180d" | "all";

export interface PeriodWithChange {
  /** Total in the current period. */
  count: number;
  /** Total in the prior period of equal length. Null when the prior
   *  window is unavailable (no rows / all-time view). */
  previous: number | null;
  /** Percentage change vs prior period. Null when previous is null
   *  or zero (avoids div-by-zero noise). */
  changePercent: number | null;
}

export interface ShopRiskProfile {
  shopId: string;
  period: RiskPeriod;
  /** Number of UTC days the period covers. `null` for all-time. */
  windowDays: number | null;

  /** Chargeback rate for the selected period. */
  rate: ChargebackRateResult;

  /** Disputes initiated in the period (period-scoped). */
  totalDisputes: PeriodWithChange;
  /** Orders in the period (snapshot-fed). */
  totalOrders: PeriodWithChange;

  /** Sum of `amount` for disputes whose normalized_status is active.
   *  Always all-time — the merchant's current at-risk dollar value
   *  isn't period-bound. */
  amountAtRisk: number;
  currencyCode: string;

  /** Reason mix in the period. */
  reasonBreakdown: {
    fraud: number;
    fulfillment: number; // "Item not received" + "Quality"
    other: number;
  };
  /** Outcome mix in the period. `pending` = open / no terminal
   *  outcome yet. */
  outcomeBreakdown: {
    won: number;
    lost: number;
    pending: number;
  };
  /** Win rate for the period: won / (won + lost), 0 when neither
   *  is positive. */
  winRate: number;

  /** Inquiry-to-chargeback signal (period-scoped). */
  inquiryCount: number;
  chargebackCount: number;

  /** Weekly trend over the period — disputes + orders dual-bar.
   *  Bucket count adapts to period (30d → 4 weeks, 90d → 13 weeks,
   *  180d → 26 buckets bi-weekly, all → monthly). */
  trend: Array<{ bucketStart: string; disputeCount: number; orderCount: number }>;

  /** Most recent snapshot `last_synced_at` across the window. */
  lastSyncedAt: string | null;
  /** % of expected snapshot days actually present. 100 = fully
   *  backfilled. */
  dataCompleteness: number;

  /** Active subscription pricing (driven by `shops.plan`). */
  monthlyRevenue: MonthlyRevenue;
  /** Approximate total invoiced over the window (monthly × months
   *  in period). Marked `isApproximate: true` — see shopBilling. */
  totalInvoiced: InvoicedAmount;
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

const ACTIVE_NORMALIZED = new Set([
  "new", "in_progress", "needs_review", "ready_to_submit",
  "action_needed", "submitted", "submitted_to_shopify",
  "waiting_on_issuer", "submitted_to_bank",
]);

/** Days mapping for fixed periods. `all` returns null. */
function daysForPeriod(period: RiskPeriod): number | null {
  if (period === "30d") return 30;
  if (period === "90d") return 90;
  if (period === "180d") return 180;
  return null;
}

/** Bucket plan for the trend chart per period. */
function trendBucketPlan(
  windowDays: number,
): { count: number; daysPerBucket: number } {
  // Aim for ~12 buckets, weekly when possible, biweekly for 180d,
  // monthly for all-time.
  if (windowDays <= 30) return { count: 4, daysPerBucket: 7 };
  if (windowDays <= 90) return { count: 13, daysPerBucket: 7 };
  if (windowDays <= 180) return { count: 13, daysPerBucket: 14 };
  return { count: 12, daysPerBucket: 30 };
}

function emptyTrend(
  fromDate: string,
  bucketCount: number,
  daysPerBucket: number,
): Array<{ bucketStart: string; disputeCount: number; orderCount: number }> {
  const buckets: Array<{ bucketStart: string; disputeCount: number; orderCount: number }> = [];
  const start = new Date(`${fromDate}T00:00:00Z`);
  for (let i = 0; i < bucketCount; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * daysPerBucket);
    buckets.push({
      bucketStart: d.toISOString().slice(0, 10),
      disputeCount: 0,
      orderCount: 0,
    });
  }
  return buckets;
}

function bucketIndexFor(
  dateIso: string,
  fromDate: string,
  daysPerBucket: number,
): number {
  const d = new Date(`${dateIso}T00:00:00Z`).getTime();
  const start = new Date(`${fromDate}T00:00:00Z`).getTime();
  const days = Math.floor((d - start) / (24 * 60 * 60 * 1000));
  return Math.floor(days / daysPerBucket);
}

interface SnapshotRow {
  date: string;
  order_count: number | null;
  chargeback_count: number | null;
  last_synced_at: string | null;
}

interface DisputeRow {
  id: string;
  amount: number | null;
  currency_code: string | null;
  reason: string | null;
  phase: string | null;
  final_outcome: string | null;
  normalized_status: string | null;
  initiated_at: string | null;
}

export async function getShopRiskProfile(
  shopId: string,
  options: { period?: RiskPeriod } = {},
): Promise<ShopRiskProfile> {
  const period = options.period ?? "90d";
  const windowDays = daysForPeriod(period);
  const sb = getServiceClient();
  const today = new Date();
  const toDate = defaultWindowEndDate(today);

  // Resolve the from-date and prior-window from-date.
  let fromDate: string;
  let priorFromDate: string | null;
  let priorToDate: string | null;
  if (windowDays === null) {
    // All-time — find the earliest snapshot row date as the lower bound.
    const { data: earliestRows } = await sb
      .from("shop_daily_metrics")
      .select("date")
      .eq("shop_id", shopId)
      .order("date", { ascending: true })
      .limit(1);
    fromDate = earliestRows?.[0]?.date ?? toDate;
    priorFromDate = null;
    priorToDate = null;
  } else {
    fromDate = windowStartDate(toDate, windowDays);
    const priorTo = (() => {
      const d = new Date(`${fromDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    priorToDate = priorTo;
    priorFromDate = windowStartDate(priorTo, windowDays);
  }

  // ── Chargeback rate (re-uses the existing computeChargebackRate) ─
  const rate = await computeChargebackRate({
    shopId,
    fromDate: windowDays === null ? undefined : fromDate,
    toDate,
  });

  // ── Snapshot rows for the current window (orders, sync, completeness) ─
  const { data: snapRowsRaw } = await sb
    .from("shop_daily_metrics")
    .select("date, order_count, chargeback_count, last_synced_at")
    .eq("shop_id", shopId)
    .gte("date", fromDate)
    .lte("date", toDate)
    .order("date", { ascending: true });
  const snapRows = (snapRowsRaw ?? []) as SnapshotRow[];

  let currentOrderCount = 0;
  let lastSyncedAt: string | null = null;
  for (const r of snapRows) {
    currentOrderCount += r.order_count ?? 0;
    if (r.last_synced_at && (!lastSyncedAt || r.last_synced_at > lastSyncedAt)) {
      lastSyncedAt = r.last_synced_at;
    }
  }

  // ── Prior-window order count for trend delta ─
  let previousOrderCount: number | null = null;
  if (priorFromDate && priorToDate) {
    const { data: priorSnap } = await sb
      .from("shop_daily_metrics")
      .select("order_count")
      .eq("shop_id", shopId)
      .gte("date", priorFromDate)
      .lte("date", priorToDate);
    previousOrderCount = (priorSnap ?? []).reduce(
      (s, r: Record<string, unknown>) => s + ((r.order_count as number | null) ?? 0),
      0,
    );
  }

  // ── Disputes for the current window + prior window ─
  const { data: dispRowsRaw } = await sb
    .from("disputes")
    .select("id, amount, currency_code, reason, phase, final_outcome, normalized_status, initiated_at")
    .eq("shop_id", shopId)
    .gte("initiated_at", `${fromDate}T00:00:00Z`);
  const disputes = (dispRowsRaw ?? []) as DisputeRow[];

  let priorDisputeCount: number | null = null;
  if (priorFromDate && priorToDate) {
    const { count: priorCount } = await sb
      .from("disputes")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .gte("initiated_at", `${priorFromDate}T00:00:00Z`)
      .lte("initiated_at", `${priorToDate}T23:59:59.999Z`);
    priorDisputeCount = priorCount ?? 0;
  }

  // ── Aggregate the current-window dispute set ─
  const reasonBreakdown = { fraud: 0, fulfillment: 0, other: 0 };
  const outcomeBreakdown = { won: 0, lost: 0, pending: 0 };
  let inquiryCount = 0;
  let chargebackCount = 0;
  let amountAtRisk = 0;
  const currencyCounts: Record<string, number> = {};

  for (const d of disputes) {
    const initiated = String(d.initiated_at ?? "");
    const dateIso = initiated.slice(0, 10);
    // Defensive: skip rows that fall outside the window even though
    // the SQL filter should have excluded them already.
    if (dateIso < fromDate || dateIso > toDate) continue;

    const fam = classifyReasonFamily(d.reason);
    reasonBreakdown[fam] += 1;

    const outcome = String(d.final_outcome ?? "");
    if (outcome === "won") outcomeBreakdown.won += 1;
    else if (outcome === "lost") outcomeBreakdown.lost += 1;
    else outcomeBreakdown.pending += 1;

    if (d.phase === "inquiry") inquiryCount += 1;
    else if (d.phase === "chargeback") chargebackCount += 1;

    const ns = String(d.normalized_status ?? "new");
    if (ACTIVE_NORMALIZED.has(ns)) {
      amountAtRisk += Number(d.amount) || 0;
    }

    const c = String(d.currency_code ?? "USD");
    currencyCounts[c] = (currencyCounts[c] ?? 0) + 1;
  }

  const totalDisputeCount =
    reasonBreakdown.fraud + reasonBreakdown.fulfillment + reasonBreakdown.other;
  const winLossDenom = outcomeBreakdown.won + outcomeBreakdown.lost;
  const winRate =
    winLossDenom > 0 ? Math.round((outcomeBreakdown.won / winLossDenom) * 100) : 0;

  const currencyCode =
    Object.entries(currencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";

  // ── Trend (dual-bar disputes + orders) ─
  const effectiveWindowDays =
    windowDays ??
    Math.max(
      1,
      Math.round(
        (new Date(`${toDate}T00:00:00Z`).getTime() -
          new Date(`${fromDate}T00:00:00Z`).getTime()) /
          (24 * 60 * 60 * 1000),
      ),
    );
  const plan = trendBucketPlan(effectiveWindowDays);
  const trendBuckets = emptyTrend(fromDate, plan.count, plan.daysPerBucket);

  for (const d of disputes) {
    const initiated = String(d.initiated_at ?? "");
    if (!initiated) continue;
    const dateIso = initiated.slice(0, 10);
    if (dateIso < fromDate || dateIso > toDate) continue;
    const idx = bucketIndexFor(dateIso, fromDate, plan.daysPerBucket);
    if (idx < 0 || idx >= trendBuckets.length) continue;
    trendBuckets[idx].disputeCount += 1;
  }
  for (const r of snapRows) {
    const idx = bucketIndexFor(r.date, fromDate, plan.daysPerBucket);
    if (idx < 0 || idx >= trendBuckets.length) continue;
    trendBuckets[idx].orderCount += r.order_count ?? 0;
  }

  const dataCompleteness =
    effectiveWindowDays > 0
      ? Math.min(100, Math.round((snapRows.length / effectiveWindowDays) * 100))
      : 0;

  // ── Billing ──
  const { data: shopRow } = await sb
    .from("shops")
    .select("plan")
    .eq("id", shopId)
    .maybeSingle();
  const plan_ = (shopRow?.plan as string | null) ?? "free";
  const monthlyRevenue = monthlyRevenueForPlan(plan_);
  const totalInvoiced = totalInvoicedForPeriod(plan_, effectiveWindowDays);

  return {
    shopId,
    period,
    windowDays,
    rate,
    totalDisputes: {
      count: totalDisputeCount,
      previous: priorDisputeCount,
      changePercent:
        priorDisputeCount === null || priorDisputeCount === 0
          ? null
          : Math.round(((totalDisputeCount - priorDisputeCount) / priorDisputeCount) * 100),
    },
    totalOrders: {
      count: currentOrderCount,
      previous: previousOrderCount,
      changePercent:
        previousOrderCount === null || previousOrderCount === 0
          ? null
          : Math.round(((currentOrderCount - previousOrderCount) / previousOrderCount) * 100),
    },
    amountAtRisk,
    currencyCode,
    reasonBreakdown,
    outcomeBreakdown,
    winRate,
    inquiryCount,
    chargebackCount,
    trend: trendBuckets,
    lastSyncedAt,
    dataCompleteness,
    monthlyRevenue,
    totalInvoiced,
  };
}
