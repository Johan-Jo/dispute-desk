/**
 * GET /api/dashboard/insights/initial-analysis
 *
 * Single endpoint powering both the dashboard insight banner and the
 * `/app/insights/initial-analysis` page. Bundles:
 *   - Total historical orders analyzed (the headline figure).
 *   - Recent-window (90d) high-risk + high-risk-fulfilled percentages
 *     for the banner body.
 *   - 90d chargeback rate + threshold-classified status for the
 *     supporting/secondary line.
 *   - Risk-level breakdown for the initial-analysis page.
 *   - Historical import state so the UI knows whether to render at all.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  classifyScopeGrant,
  enqueueShopOrdersBackfill,
} from "@/lib/disputes/backfillOrders";

export const runtime = "nodejs";

function utcDateNDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface InsightsResponse {
  available: boolean;
  ordersAnalyzed: number;
  windowStart90d: string;
  highRiskPct: number | null;
  fulfilledHighRiskPct: number | null;
  acceptanceRatePct: number | null;
  fraudDisputeRatePct: number | null;
  shopifyProtectCoveragePct: number | null;
  chargebackRate90d: number | null;
  chargebackHealth: "good" | "at_risk" | "elevated" | "unknown";
  /** True when the 90-day order denominator is large enough for the
   *  chargeback-rate classification to be statistically meaningful
   *  (PRD §11 low-volume threshold = 50). When false, the UI must NOT
   *  display a colored verdict — show "Insufficient dispute history"
   *  instead. Protects low-volume merchants from misleading severity
   *  labels on tiny sample sizes. */
  chargebackHealthAvailable: boolean;
  chargebackOrders90d: number;
  riskBreakdown: {
    low: number;
    medium: number;
    high: number;
    none: number;
    pending: number;
  };
  historicalImportStatus:
    | "not_started"
    | "in_progress"
    | "complete"
    | "failed";
  historicalImportOrdersTotal: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  historicalImportCompletedAt: string | null;
  /** Live offline-session scope tier. Distinct from
   *  `historicalImportScopeGranted` (which captures the tier as of the
   *  last backfill). When they differ, the merchant has re-OAuthed
   *  but the backfill hasn't re-run yet — the dashboard surfaces the
   *  re-OAuth banner based on this live value. */
  currentScopeGrant: "default_window" | "read_all_orders";
}

function classifyChargebackHealth(
  rate: number | null,
): InsightsResponse["chargebackHealth"] {
  if (rate === null) return "unknown";
  if (rate < 0.4) return "good";
  if (rate <= 0.6) return "at_risk";
  return "elevated";
}

/** Minimum 90-day order denominator at which a chargeback rate
 *  classification carries enough signal to surface in the UI. Below
 *  this we render "Insufficient dispute history" rather than a colored
 *  severity verdict. Matches PRD §11 low-volume threshold used by
 *  computeChargebackRate. */
const CHARGEBACK_VERDICT_MIN_ORDERS = 50;

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();

  // ── Live offline-session scopes ────────────────────────────────
  // Lightweight read — we only need the scopes string, not the
  // (encrypted) access token. Resolves whether the merchant has the
  // expanded order-history grant in their current session.
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
      "historical_import_status, historical_import_orders_total, historical_import_since_date, historical_import_scope_granted, historical_import_completed_at",
    )
    .eq("id", shopId)
    .single();

  const status: InsightsResponse["historicalImportStatus"] =
    (shopRow?.historical_import_status as InsightsResponse["historicalImportStatus"]) ??
    "not_started";
  const ordersTotal =
    (shopRow?.historical_import_orders_total as number | null) ?? 0;

  // Self-heal: see fraud-metrics route for the same pattern. Idempotent
  // via enqueueShopOrdersBackfill's own queued/running/complete guards.
  if (status === "not_started") {
    enqueueShopOrdersBackfill(shopId).catch((err) => {
      console.warn(
        "[insights] self-heal backfill enqueue failed:",
        err instanceof Error ? err.message : err,
      );
    });
  }

  // ── 90d fraud rollup ────────────────────────────────────────────
  const windowStart90d = utcDateNDaysAgo(90);
  const { data: fraudRows } = await sb
    .from("shop_fraud_daily_metrics")
    .select(
      "orders_total, orders_low, orders_medium, orders_high, orders_none, orders_pending, orders_fulfilled_high_risk, fraud_disputes, fully_protected_value, eligible_protected_value",
    )
    .eq("shop_id", shopId)
    .gte("date", windowStart90d);

  let ordersTotal90 = 0;
  let ordersLow = 0;
  let ordersMedium = 0;
  let ordersHigh = 0;
  let ordersNone = 0;
  let ordersPending = 0;
  let ordersFulfilledHighRisk = 0;
  let fraudDisputes = 0;
  let fullyProtectedValue = 0;
  let eligibleProtectedValue = 0;
  for (const r of fraudRows ?? []) {
    ordersTotal90 += r.orders_total ?? 0;
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

  // Acceptance rate: see fraud-metrics route for the formula contract.
  // Numerator = LOW + MEDIUM + NONE (Shopify's "cleared" bucket counts
  // as accepted). Denominator = total − PENDING (only orders still
  // awaiting analysis are excluded).
  const acceptanceDenom = ordersTotal90 - ordersPending;
  const highRiskPct = rate(ordersHigh, ordersTotal90);
  const fulfilledHighRiskPct = rate(ordersFulfilledHighRisk, ordersHigh);
  const acceptanceRatePct = rate(
    ordersLow + ordersMedium + ordersNone,
    acceptanceDenom,
  );
  const fraudDisputeRatePct = rate(fraudDisputes, ordersTotal90);
  const shopifyProtectCoveragePct = rate(
    fullyProtectedValue,
    eligibleProtectedValue,
  );

  // ── 90d chargeback rate ────────────────────────────────────────
  const { data: dailyRows } = await sb
    .from("shop_daily_metrics")
    .select("order_count, chargeback_count")
    .eq("shop_id", shopId)
    .gte("date", windowStart90d);
  let cbOrderTotal = 0;
  let cbCount = 0;
  for (const r of dailyRows ?? []) {
    cbOrderTotal += r.order_count ?? 0;
    cbCount += r.chargeback_count ?? 0;
  }
  const chargebackRate90d = rate(cbCount, cbOrderTotal);

  const response: InsightsResponse = {
    available: status === "complete",
    ordersAnalyzed: ordersTotal,
    windowStart90d,
    highRiskPct,
    fulfilledHighRiskPct,
    acceptanceRatePct,
    fraudDisputeRatePct,
    shopifyProtectCoveragePct,
    chargebackRate90d,
    chargebackHealth: classifyChargebackHealth(chargebackRate90d),
    chargebackHealthAvailable: cbOrderTotal >= CHARGEBACK_VERDICT_MIN_ORDERS,
    chargebackOrders90d: cbOrderTotal,
    riskBreakdown: {
      low: ordersLow,
      medium: ordersMedium,
      high: ordersHigh,
      none: ordersNone,
      pending: ordersPending,
    },
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
  };

  return NextResponse.json(response);
}
