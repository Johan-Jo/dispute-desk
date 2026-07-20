/**
 * GET /api/dashboard/insights/initial-analysis
 *
 * Single endpoint powering both the dashboard insight banner and the
 * `/app/insights/initial-analysis` page. Bundles:
 *   - Total historical orders analyzed (the headline figure).
 *   - 30d current + 30d prior comparison for every KPI (the page's
 *     month-over-month deltas).
 *   - 90d fraud rollup (kept for backwards-compat with the embedded
 *     dashboard's OperationalInsightsStrip).
 *   - 90d chargeback rate + threshold-classified status.
 *   - 8-week weekly sparkline for chargeback rate (rendered on the
 *     Risk Intelligence page).
 *   - Risk-level breakdown (all-time).
 *   - Risk-to-dispute conversion (all-time).
 *   - Historical import state so the UI knows whether to render at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  classifyScopeGrant,
  enqueueShopOrdersBackfill,
} from "@/lib/disputes/backfillOrders";
import { recommendPlan, type PlanRecommendation } from "@/lib/billing/recommendPlan";
import { upsertPlanRecommendation } from "@/lib/billing/persistRecommendation";
import { IMPERSONATION_MODE_HEADER } from "@/lib/admin/impersonation";

export const runtime = "nodejs";

function utcDateNDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface InsightsResponse {
  available: boolean;
  ordersAnalyzed: number;

  // ── 90d fields (kept for backwards-compat with dashboard strip) ──
  windowStart90d: string;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  acceptanceRatePct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRate90d: number | null;
  chargebackHealth: "good" | "at_risk" | "elevated" | "unknown";
  chargebackHealthAvailable: boolean;
  chargebackOrders90d: number;

  // ── 30d current + prior 30d (MoM comparison) ─────────────────────
  // Each "Window" carries the aggregate metrics for its date range.
  // Prior = days 60→30 ago. Current = days 30→0 ago.
  windowStart30d: string;
  windowStart30dPrior: string;
  current30d: PeriodWindow;
  prior30d: PeriodWindow;

  // ── 8-week weekly sparkline for chargeback rate ─────────────────
  // 8 points, oldest first. Each point: weekStartIso, rate (null when
  // the week had zero orders), orderCount.
  chargebackRateSparklineWeekly: Array<{
    weekStart: string;
    rate: number | null;
    orderCount: number;
  }>;

  // ── Risk breakdown + conversion (all-time) ──────────────────────
  riskBreakdown: {
    low: number;
    medium: number;
    high: number;
    none: number;
    pending: number;
  };
  riskToDisputeConversion: {
    high: RiskConversionBucket;
    medium: RiskConversionBucket;
    low: RiskConversionBucket;
    none: RiskConversionBucket;
    pending: RiskConversionBucket;
  };

  // ── Shop + session state ────────────────────────────────────────
  historicalImportStatus:
    | "not_started"
    | "in_progress"
    | "complete"
    | "failed";
  historicalImportOrdersTotal: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  historicalImportCompletedAt: string | null;
  currentScopeGrant: "default_window" | "read_all_orders";
  dismissedBanners: Record<string, string>;

  /** Plan recommendation derived from chargeback volume. Present only
   *  when historicalImportStatus === "complete" AND shop is on Free
   *  (null plan or "free"). Risk Intel page renders the recommendation
   *  card from this; PR 2 will add the dashboard banner. */
  recommendation: PlanRecommendation | null;
}

interface PeriodWindow {
  ordersTotal: number;
  acceptanceRatePct: number | null;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRatePct: number | null;
  /** Order denominator for the window (sum of daily `order_count`).
   *  Despite the legacy name this is the ORDER count, used by the
   *  chargeback-health verdict's "enough orders to judge" gate. */
  chargebackOrders: number;
  /** Actual chargeback count for the window (sum of daily
   *  `chargeback_count`). This — NOT `chargebackOrders` — is the
   *  monthly-volume signal the plan recommender sizes on. */
  chargebackCount: number;
  /** % of Shopify Payments CARD orders that completed 3-D Secure
   *  authentication. Numerator: orders with three_ds_authenticated=true.
   *  Denominator: payment_gateway='shopify_payments' AND
   *  payment_method='card' — BNPL (Klarna) and wallets (Apple Pay /
   *  Shop Pay) can never carry a card-3DS receipt block, so counting
   *  them structurally diluted the rate on BNPL-heavy shops (cay:
   *  cards are only ~30% of orders). Null when the denominator is
   *  zero. */
  threeDsAuthRatePct: number | null;
  threeDsAuthOrders: number;
  threeDsAuthEligibleOrders: number;
  /** Median number of HOURS between processed_at and fulfilled_at for
   *  orders fulfilled in this window. Null when no fulfilled orders
   *  in the window. Median (not mean) so a few outliers don't skew. */
  medianFulfillmentHours: number | null;
  fulfilledOrdersCount: number;
  /** Confirmed-delivery rate. Numerator: orders with carrier-confirmed
   *  delivery (delivery_status='Delivered' OR delivered_at_tracking
   *  set). Denominator: orders that were fulfilled (fulfilled_at set).
   *  Tracking-app data via lib/shopify/trackingApps.ts. */
  confirmedDeliveryRatePct: number | null;
  confirmedDeliveryOrders: number;
  fulfilledForDeliveryCount: number;
  /** Signed-for rate. Numerator: orders with signed_by_name set.
   *  Denominator: orders with carrier-confirmed delivery (so we don't
   *  dilute by orders still in transit). Strongest dispute-defense
   *  signal we capture — bank rebuttals cite the signature name. */
  signedForRatePct: number | null;
  signedForOrders: number;
}

interface RiskConversionBucket {
  orders: number;
  disputes: number;
  conversionPct: number | null;
}

function classifyChargebackHealth(
  r: number | null,
): InsightsResponse["chargebackHealth"] {
  if (r === null) return "unknown";
  if (r < 0.4) return "good";
  if (r <= 0.6) return "at_risk";
  return "elevated";
}

const CHARGEBACK_VERDICT_MIN_ORDERS = 50;
const RISK_CONVERSION_MIN_ORDERS = 30;

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

interface FraudRollupRow {
  date: string;
  orders_total: number;
  orders_low: number;
  orders_medium: number;
  orders_high: number;
  orders_none: number;
  orders_pending: number;
  orders_fulfilled_high_risk: number;
  fraud_disputes: number;
  fully_protected_value: number | string;
  eligible_protected_value: number | string;
}

interface DailyRow {
  date: string;
  order_count: number;
  chargeback_count: number;
}

interface OrderForKpi {
  payment_gateway: string | null;
  payment_method: string | null;
  three_ds_authenticated: boolean | null;
  processed_at: string | null;
  fulfilled_at: string | null;
  delivery_status: string | null;
  delivered_at_tracking: string | null;
  signed_by_name: string | null;
}

/** Pure: 3DS auth rate + median fulfillment hours over a subset of
 *  shopify_orders rows. Returns the three counters PeriodWindow
 *  expects. Filters by processed_at falling in [from, toExclusive). */
function compute3dsAndFulfillment(
  rows: OrderForKpi[],
  fromIso: string,
  toExclusiveIso: string,
): {
  threeDsAuthRatePct: number | null;
  threeDsAuthOrders: number;
  threeDsAuthEligibleOrders: number;
  medianFulfillmentHours: number | null;
  fulfilledOrdersCount: number;
  confirmedDeliveryRatePct: number | null;
  confirmedDeliveryOrders: number;
  fulfilledForDeliveryCount: number;
  signedForRatePct: number | null;
  signedForOrders: number;
} {
  let authEligible = 0;
  let authPositive = 0;
  let fulfilledForDelivery = 0;
  let confirmedDelivered = 0;
  let signedForCount = 0;
  const fulfillmentHours: number[] = [];
  const fromMs = new Date(`${fromIso}T00:00:00Z`).getTime();
  const toMs = new Date(`${toExclusiveIso}T00:00:00Z`).getTime();
  for (const r of rows) {
    if (!r.processed_at) continue;
    const procMs = new Date(r.processed_at).getTime();
    if (procMs < fromMs || procMs >= toMs) continue;
    // Card orders only — BNPL/wallet methods never carry a card-3DS
    // receipt block, so they belong in neither side of this rate.
    if (
      r.payment_gateway === "shopify_payments" &&
      r.payment_method === "card"
    ) {
      authEligible += 1;
      if (r.three_ds_authenticated === true) authPositive += 1;
    }
    if (r.fulfilled_at) {
      const fulMs = new Date(r.fulfilled_at).getTime();
      const deltaHours = (fulMs - procMs) / 3600000;
      if (deltaHours >= 0 && deltaHours < 24 * 60) {
        fulfillmentHours.push(deltaHours);
      }
      // Confirmed-delivery denominator: any order that was fulfilled.
      fulfilledForDelivery += 1;
      // Carrier-confirmed delivery — tracking-app metafield says so.
      const carrierDelivered =
        r.delivery_status === "Delivered" || !!r.delivered_at_tracking;
      if (carrierDelivered) {
        confirmedDelivered += 1;
        if (r.signed_by_name && r.signed_by_name.trim().length > 0) {
          signedForCount += 1;
        }
      }
    }
  }
  fulfillmentHours.sort((a, b) => a - b);
  const median =
    fulfillmentHours.length === 0
      ? null
      : fulfillmentHours[Math.floor(fulfillmentHours.length / 2)];
  return {
    threeDsAuthRatePct: rate(authPositive, authEligible),
    threeDsAuthOrders: authPositive,
    threeDsAuthEligibleOrders: authEligible,
    medianFulfillmentHours: median === null ? null : Math.round(median * 10) / 10,
    fulfilledOrdersCount: fulfillmentHours.length,
    confirmedDeliveryRatePct: rate(confirmedDelivered, fulfilledForDelivery),
    confirmedDeliveryOrders: confirmedDelivered,
    fulfilledForDeliveryCount: fulfilledForDelivery,
    signedForRatePct: rate(signedForCount, confirmedDelivered),
    signedForOrders: signedForCount,
  };
}

/** Aggregate the fraud-rollup rows + daily-metrics rows + order rows
 *  for a given date window into a single PeriodWindow snapshot. All
 *  three inputs are pre-fetched; the function filters each to the
 *  requested window. */
function aggregateWindow(
  fraudRows: FraudRollupRow[],
  dailyRows: DailyRow[],
  orderRows: OrderForKpi[],
  fromIso: string,
  toExclusiveIso: string,
): PeriodWindow {
  let ordersTotal = 0;
  let ordersLow = 0;
  let ordersMedium = 0;
  let ordersHigh = 0;
  let ordersNone = 0;
  let ordersPending = 0;
  let ordersFulfilledHighRisk = 0;
  let fraudDisputes = 0;
  let fullyProtectedValue = 0;
  let eligibleProtectedValue = 0;
  for (const r of fraudRows) {
    if (r.date < fromIso || r.date >= toExclusiveIso) continue;
    ordersTotal += r.orders_total ?? 0;
    ordersLow += r.orders_low ?? 0;
    ordersMedium += r.orders_medium ?? 0;
    ordersHigh += r.orders_high ?? 0;
    ordersNone += r.orders_none ?? 0;
    ordersPending += r.orders_pending ?? 0;
    ordersFulfilledHighRisk += r.orders_fulfilled_high_risk ?? 0;
    fraudDisputes += r.fraud_disputes ?? 0;
    fullyProtectedValue += Number(r.fully_protected_value ?? 0);
    eligibleProtectedValue += Number(r.eligible_protected_value ?? 0);
  }

  let cbOrders = 0;
  let cbCount = 0;
  for (const r of dailyRows) {
    if (r.date < fromIso || r.date >= toExclusiveIso) continue;
    cbOrders += r.order_count ?? 0;
    cbCount += r.chargeback_count ?? 0;
  }

  const acceptanceDenom = ordersTotal - ordersPending;
  const tdsAndFul = compute3dsAndFulfillment(orderRows, fromIso, toExclusiveIso);
  return {
    ordersTotal,
    acceptanceRatePct: rate(ordersLow + ordersMedium + ordersNone, acceptanceDenom),
    highRiskPct: rate(ordersHigh, ordersTotal),
    fulfilledHighRiskPct: rate(ordersFulfilledHighRisk, ordersHigh),
    fraudDisputeRatePct: rate(fraudDisputes, ordersTotal),
    shopifyProtectCoveragePct: rate(fullyProtectedValue, eligibleProtectedValue),
    chargebackRatePct: rate(cbCount, cbOrders),
    chargebackOrders: cbOrders,
    chargebackCount: cbCount,
    ...tdsAndFul,
  };
}

/** Walk `dailyRows` across 8 weekly buckets ending today (UTC). Each
 *  bucket is 7 days long; the chargeback rate is computed inside the
 *  bucket. Returns rate=null when the bucket had zero orders. */
function weeklySparkline(
  dailyRows: DailyRow[],
  now: Date = new Date(),
): InsightsResponse["chargebackRateSparklineWeekly"] {
  const buckets: InsightsResponse["chargebackRateSparklineWeekly"] = [];
  for (let i = 7; i >= 0; i--) {
    const end = new Date(now);
    end.setUTCDate(end.getUTCDate() - i * 7);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 7);
    const startIso = start.toISOString().slice(0, 10);
    const endIso = end.toISOString().slice(0, 10);
    let orders = 0;
    let cbs = 0;
    for (const r of dailyRows) {
      if (r.date < startIso || r.date >= endIso) continue;
      orders += r.order_count ?? 0;
      cbs += r.chargeback_count ?? 0;
    }
    buckets.push({
      weekStart: startIso,
      orderCount: orders,
      rate: orders > 0 ? Math.round((cbs / orders) * 1000) / 10 : null,
    });
  }
  return buckets;
}

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // ── Live offline-session scopes ────────────────────────────────
  const { data: sessionRow } = await sb
    .from("shop_sessions")
    .select("scopes")
    .eq("shop_id", shopId)
    .eq("session_type", "offline")
    .is("user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const currentScopeGrant = classifyScopeGrant(
    (sessionRow?.scopes as string | null) ?? null,
  );

  // ── Shop state ─────────────────────────────────────────────────
  const { data: shopRow } = await sb
    .from("shops")
    .select(
      "plan, historical_import_status, historical_import_orders_total, historical_import_since_date, historical_import_scope_granted, historical_import_completed_at, dismissed_banners",
    )
    .eq("id", shopId)
    .single();

  const status: InsightsResponse["historicalImportStatus"] =
    (shopRow?.historical_import_status as InsightsResponse["historicalImportStatus"]) ??
    "not_started";
  const ordersTotal =
    (shopRow?.historical_import_orders_total as number | null) ?? 0;

  // Suppress the self-heal backfill enqueue during a READ-ONLY admin
  // impersonation preview — it's a write side-effect on an otherwise-GET
  // route (the middleware method-gate can't catch a mutating GET).
  const impersonationRead =
    req.headers.get(IMPERSONATION_MODE_HEADER) === "read";
  if (status === "not_started" && !impersonationRead) {
    enqueueShopOrdersBackfill(shopId).catch((err) => {
      console.warn(
        "[insights] self-heal backfill enqueue failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  // ── Pull the rollup tables once for the full 90-day window ─────
  // We slice that single dataset for: current 30d, prior 30d, and
  // the all-90d aggregate. Saves three round-trips.
  const windowStart90d = utcDateNDaysAgo(90);
  const windowStart30d = utcDateNDaysAgo(30);
  const windowStart30dPrior = utcDateNDaysAgo(60);
  const todayIso = utcDateNDaysAgo(0);

  const { data: fraudRows } = await sb
    .from("shop_fraud_daily_metrics")
    .select(
      "date, orders_total, orders_low, orders_medium, orders_high, orders_none, orders_pending, orders_fulfilled_high_risk, fraud_disputes, fully_protected_value, eligible_protected_value",
    )
    .eq("shop_id", shopId)
    .gte("date", windowStart90d);

  const { data: dailyRows } = await sb
    .from("shop_daily_metrics")
    .select("date, order_count, chargeback_count")
    .eq("shop_id", shopId)
    .gte("date", windowStart90d);

  // 3DS rate + median fulfillment time aren't in the rollup tables,
  // so pull the per-order columns needed for both. Window aligned to
  // 90d for consistency; in-memory filter per-window.
  const windowStart90dIso = `${windowStart90d}T00:00:00Z`;
  async function fetchOrderRowsFor90d(): Promise<OrderForKpi[]> {
    const out: OrderForKpi[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("shopify_orders")
        .select(
          "payment_gateway, payment_method, three_ds_authenticated, processed_at, fulfilled_at, delivery_status, delivered_at_tracking, signed_by_name",
        )
        .eq("shop_id", shopId)
        .gte("processed_at", windowStart90dIso)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map((r) => r as OrderForKpi));
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  const orderRowsForKpi = await fetchOrderRowsFor90d();

  const fraud = (fraudRows ?? []) as FraudRollupRow[];
  const daily = (dailyRows ?? []) as DailyRow[];

  // ── 90d aggregate (kept for the dashboard strip) ───────────────
  const win90 = aggregateWindow(fraud, daily, orderRowsForKpi, windowStart90d, todayIso);

  // ── 30d current vs prior 30d ───────────────────────────────────
  const current30d = aggregateWindow(fraud, daily, orderRowsForKpi, windowStart30d, todayIso);
  const prior30d = aggregateWindow(fraud, daily, orderRowsForKpi, windowStart30dPrior, windowStart30d);

  // ── 8-week weekly sparkline (chargeback rate) ──────────────────
  const chargebackRateSparklineWeekly = weeklySparkline(daily);

  // ── Risk-to-dispute conversion (all-time) ──────────────────────
  async function fetchAllOrders(): Promise<
    Array<{ shopify_order_id: string; risk_level_initial: string | null }>
  > {
    const out: Array<{ shopify_order_id: string; risk_level_initial: string | null }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("shopify_orders")
        .select("shopify_order_id, risk_level_initial")
        .eq("shop_id", shopId)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(
        ...(data ?? []).map((d) => ({
          shopify_order_id: d.shopify_order_id as string,
          risk_level_initial: (d.risk_level_initial as string | null) ?? null,
        })),
      );
      if (!data || data.length < 1000) break;
    }
    return out;
  }
  async function fetchAllDisputedGids(): Promise<Set<string>> {
    const out = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("disputes")
        .select("order_gid")
        .eq("shop_id", shopId)
        .not("order_gid", "is", null)
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        if (r.order_gid) out.add(r.order_gid as string);
      }
      if (!data || data.length < 1000) break;
    }
    return out;
  }

  const allOrders = await fetchAllOrders();
  const disputedGids = await fetchAllDisputedGids();
  const conversionBuckets = {
    high:    { orders: 0, disputes: 0 },
    medium:  { orders: 0, disputes: 0 },
    low:     { orders: 0, disputes: 0 },
    none:    { orders: 0, disputes: 0 },
    pending: { orders: 0, disputes: 0 },
  };
  let allTimeOrdersLow = 0, allTimeOrdersMedium = 0, allTimeOrdersHigh = 0, allTimeOrdersNone = 0, allTimeOrdersPending = 0;
  for (const o of allOrders) {
    const lvl = (o.risk_level_initial ?? "").toUpperCase();
    const key =
      lvl === "HIGH"    ? "high"   :
      lvl === "MEDIUM"  ? "medium" :
      lvl === "LOW"     ? "low"    :
      lvl === "PENDING" ? "pending" :
                          "none";
    conversionBuckets[key].orders += 1;
    if (disputedGids.has(o.shopify_order_id)) {
      conversionBuckets[key].disputes += 1;
    }
    if      (key === "high")    allTimeOrdersHigh    += 1;
    else if (key === "medium")  allTimeOrdersMedium  += 1;
    else if (key === "low")     allTimeOrdersLow     += 1;
    else if (key === "pending") allTimeOrdersPending += 1;
    else                        allTimeOrdersNone    += 1;
  }
  function bucketWithPct(b: { orders: number; disputes: number }): RiskConversionBucket {
    return {
      orders: b.orders,
      disputes: b.disputes,
      conversionPct:
        b.orders >= RISK_CONVERSION_MIN_ORDERS
          ? Math.round((b.disputes / b.orders) * 1000) / 10
          : null,
    };
  }
  const riskToDisputeConversion = {
    high:    bucketWithPct(conversionBuckets.high),
    medium:  bucketWithPct(conversionBuckets.medium),
    low:     bucketWithPct(conversionBuckets.low),
    none:    bucketWithPct(conversionBuckets.none),
    pending: bucketWithPct(conversionBuckets.pending),
  };

  const response: InsightsResponse = {
    available: status === "complete",
    ordersAnalyzed: ordersTotal,

    windowStart90d,
    highRiskPct: win90.highRiskPct,
    fulfilledHighRiskPct: win90.fulfilledHighRiskPct,
    acceptanceRatePct: win90.acceptanceRatePct,
    fraudDisputeRatePct: win90.fraudDisputeRatePct,
    shopifyProtectCoveragePct: win90.shopifyProtectCoveragePct,
    chargebackRate90d: win90.chargebackRatePct,
    chargebackHealth: classifyChargebackHealth(win90.chargebackRatePct),
    chargebackHealthAvailable: win90.chargebackOrders >= CHARGEBACK_VERDICT_MIN_ORDERS,
    chargebackOrders90d: win90.chargebackOrders,

    windowStart30d,
    windowStart30dPrior,
    current30d,
    prior30d,
    chargebackRateSparklineWeekly,

    riskBreakdown: {
      low: allTimeOrdersLow,
      medium: allTimeOrdersMedium,
      high: allTimeOrdersHigh,
      none: allTimeOrdersNone,
      pending: allTimeOrdersPending,
    },
    riskToDisputeConversion,

    historicalImportStatus: status,
    historicalImportOrdersTotal: ordersTotal,
    historicalImportSinceDate:
      (shopRow?.historical_import_since_date as string | null) ?? null,
    historicalImportScopeGranted:
      (shopRow?.historical_import_scope_granted as InsightsResponse["historicalImportScopeGranted"]) ??
      null,
    historicalImportCompletedAt:
      (shopRow?.historical_import_completed_at as string | null) ?? null,
    currentScopeGrant,
    dismissedBanners:
      (shopRow?.dismissed_banners as Record<string, string> | null) ?? {},

    // Recommendation is computed only when the import has completed AND
    // the merchant is still on Free. Paid-plan shops don't see an
    // "upgrade to X" card on their own data — that would be noise.
    recommendation:
      status === "complete" &&
      ((shopRow?.plan as string | null) ?? "free") === "free"
        ? recommendPlan({
            // Use the chargeback COUNT, not `chargebackOrders` (which is
            // the order denominator) — the recommender sizes on monthly
            // chargeback volume.
            chargebackOrders90d: win90.chargebackCount,
            chargebackOrders30d: current30d.chargebackCount,
            ordersAnalyzed: ordersTotal,
            historicalScopeGranted:
              (shopRow?.historical_import_scope_granted as
                | "default_window"
                | "read_all_orders"
                | null) ?? null,
          })
        : null,
  };

  // Persist the recommendation so the dashboard banner + monthly cron
  // share one source of truth. Fire-and-forget: a write failure must
  // never degrade the page response, and the monthly cron will heal it.
  if (response.recommendation) {
    upsertPlanRecommendation(sb, shopId, response.recommendation).catch(
      (err) => {
        console.warn(
          "[insights] plan recommendation persist failed:",
          err instanceof Error ? err.message : err,
        );
      },
    );
  }

  return NextResponse.json(response);
}
