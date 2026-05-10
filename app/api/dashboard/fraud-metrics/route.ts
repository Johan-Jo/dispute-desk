/**
 * GET /api/dashboard/fraud-metrics?window=30d|90d|365d|all
 *
 * Returns the fraud-intelligence KPI panel for the embedded
 * dashboard. Source: `shop_fraud_daily_metrics` only — no Shopify
 * fan-out, no `shopify_orders` table scans on the hot path.
 *
 * KPI semantics (must match dashboard tooltip copy):
 *   - acceptanceRate: (orders_low + orders_medium) / (orders_total -
 *     orders_none - orders_pending). NONE + PENDING explicitly
 *     excluded; the tooltip discloses this.
 *   - highRiskRate: orders_high / orders_total.
 *   - fraudDisputeRate: fraud_disputes / orders_total.
 *   - highRiskFulfillmentRate: orders_fulfilled_high_risk /
 *     orders_high.
 *   - shopifyProtectCoverage: fully_protected_value /
 *     eligible_protected_value.
 *
 * Each KPI carries an `available` boolean — false when its
 * denominator is zero so the UI renders "—" instead of a misleading
 * 0%. The `historicalImportStatus` field lets the dashboard render
 * the "still analyzing" progress card until backfill completes.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

type WindowKey = "30d" | "90d" | "365d" | "all";

function windowDays(window: WindowKey): number | null {
  switch (window) {
    case "30d":
      return 30;
    case "90d":
      return 90;
    case "365d":
      return 365;
    case "all":
      return null;
  }
}

function utcDateNDaysAgo(days: number, now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

interface FraudMetricRow {
  date: string;
  orders_total: number;
  orders_low: number;
  orders_medium: number;
  orders_high: number;
  orders_none: number;
  orders_pending: number;
  orders_fulfilled_high_risk: number;
  fraud_disputes: number;
  total_disputes: number;
  chargebacks: number;
  fully_protected_value: number | string;
  eligible_protected_value: number | string;
  last_synced_at: string | null;
}

interface KpiValue {
  rate: number | null;
  available: boolean;
  numerator: number;
  denominator: number;
}

interface FraudMetricsResponse {
  window: WindowKey;
  windowStart: string | null;
  ordersAnalyzed: number;
  acceptanceRate: KpiValue;
  highRiskRate: KpiValue;
  fraudDisputeRate: KpiValue;
  highRiskFulfillmentRate: KpiValue;
  shopifyProtectCoverage: KpiValue;
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
  historicalImportOrdersProcessed: number;
  historicalImportSinceDate: string | null;
  historicalImportScopeGranted: "default_window" | "read_all_orders" | null;
  lastSyncedAt: string | null;
}

function rate(num: number, den: number): KpiValue {
  if (den <= 0) {
    return { rate: null, available: false, numerator: num, denominator: den };
  }
  // 1 decimal place; same rounding convention as chargebackRate.ts
  return {
    rate: Math.round((num / den) * 1000) / 10,
    available: true,
    numerator: num,
    denominator: den,
  };
}

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const window = (req.nextUrl.searchParams.get("window") ??
    "90d") as WindowKey;
  if (!["30d", "90d", "365d", "all"].includes(window)) {
    return NextResponse.json(
      { error: "window must be one of 30d, 90d, 365d, all" },
      { status: 400 },
    );
  }

  const sb = getServiceClient();

  // ── Shop-side state for the gating UI ──────────────────────────
  const { data: shopRow } = await sb
    .from("shops")
    .select(
      "historical_import_status, historical_import_orders_processed, historical_import_since_date, historical_import_scope_granted",
    )
    .eq("id", shopId)
    .single();

  // ── Metric window query ────────────────────────────────────────
  const days = windowDays(window);
  let query = sb
    .from("shop_fraud_daily_metrics")
    .select(
      "date, orders_total, orders_low, orders_medium, orders_high, orders_none, orders_pending, orders_fulfilled_high_risk, fraud_disputes, total_disputes, chargebacks, fully_protected_value, eligible_protected_value, last_synced_at",
    )
    .eq("shop_id", shopId);
  let windowStart: string | null = null;
  if (days !== null) {
    windowStart = utcDateNDaysAgo(days);
    query = query.gte("date", windowStart);
  }
  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows: FraudMetricRow[] = (data ?? []) as FraudMetricRow[];

  // Sum across the window.
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
  let lastSyncedAt: string | null = null;
  for (const r of rows) {
    ordersTotal += r.orders_total;
    ordersLow += r.orders_low;
    ordersMedium += r.orders_medium;
    ordersHigh += r.orders_high;
    ordersNone += r.orders_none;
    ordersPending += r.orders_pending;
    ordersFulfilledHighRisk += r.orders_fulfilled_high_risk;
    fraudDisputes += r.fraud_disputes;
    fullyProtectedValue += Number(r.fully_protected_value ?? 0);
    eligibleProtectedValue += Number(r.eligible_protected_value ?? 0);
    if (r.last_synced_at && (!lastSyncedAt || r.last_synced_at > lastSyncedAt)) {
      lastSyncedAt = r.last_synced_at;
    }
  }

  const acceptanceDenom = ordersTotal - ordersNone - ordersPending;
  const response: FraudMetricsResponse = {
    window,
    windowStart,
    ordersAnalyzed: ordersTotal,
    acceptanceRate: rate(ordersLow + ordersMedium, acceptanceDenom),
    highRiskRate: rate(ordersHigh, ordersTotal),
    fraudDisputeRate: rate(fraudDisputes, ordersTotal),
    highRiskFulfillmentRate: rate(ordersFulfilledHighRisk, ordersHigh),
    shopifyProtectCoverage: rate(fullyProtectedValue, eligibleProtectedValue),
    riskBreakdown: {
      low: ordersLow,
      medium: ordersMedium,
      high: ordersHigh,
      none: ordersNone,
      pending: ordersPending,
    },
    historicalImportStatus:
      (shopRow?.historical_import_status as FraudMetricsResponse["historicalImportStatus"]) ??
      "not_started",
    historicalImportOrdersProcessed:
      (shopRow?.historical_import_orders_processed as number) ?? 0,
    historicalImportSinceDate:
      (shopRow?.historical_import_since_date as string | null) ?? null,
    historicalImportScopeGranted:
      (shopRow?.historical_import_scope_granted as FraudMetricsResponse["historicalImportScopeGranted"]) ??
      null,
    lastSyncedAt,
  };

  return NextResponse.json(response);
}
