/**
 * GET /api/billing/plan-recommendation?shop_id=...
 *
 * Lightweight read of the persisted `plan_recommendations` row that powers
 * the dashboard plan-recommendation banner. Kept separate from the heavy
 * /api/dashboard/insights/initial-analysis endpoint so the dashboard can
 * decide whether to render the banner with a single small query.
 *
 * Returns `{ recommendation, show }`. `show` folds in the dismissal rule
 * (banner hidden once the merchant dismisses the current recommended plan)
 * so the client doesn't reimplement it.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import { getServiceClient } from "@/lib/supabase/server";
import { shouldShowRecommendationBanner } from "@/lib/billing/persistRecommendation";
import type { PlanId } from "@/lib/billing/plans";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId) {
    return NextResponse.json({ error: "shop_id required" }, { status: 400 });
  }

  const sb = getServiceClient();
  const { data: row } = await sb
    .from("plan_recommendations")
    .select(
      "recommended_plan, monthly_chargebacks, headroom_multiplier, reason, partial_history, dismissed_plan",
    )
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ recommendation: null, show: false });
  }

  const recommendedPlan = row.recommended_plan as string;
  const dismissedPlan = (row.dismissed_plan as string | null) ?? null;

  // The card's subtitle reads "Based on {orders} orders and {chargebacks}
  // chargebacks in the last 90 days". `plan_recommendations` stores neither,
  // so read them from the same rollup the Insights page uses rather than
  // invoking the heavy initial-analysis endpoint just for two integers.
  //
  // `chargeback_count` is the DISPUTE count and `order_count` the denominator
  // — they are NOT interchangeable. Crossing them is what told a merchant they
  // averaged 4,878 chargebacks a month against a true ~100 (see
  // lib/insights/checkpoints.types.ts). Keep them distinct here too.
  const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: metricRows } = await sb
    .from("shop_daily_metrics")
    .select("order_count, chargeback_count")
    .eq("shop_id", shopId)
    .gte("date", windowStart);

  let ordersAnalyzed = 0;
  let chargebackCount90d = 0;
  for (const m of metricRows ?? []) {
    ordersAnalyzed += (m as { order_count: number | null }).order_count ?? 0;
    chargebackCount90d +=
      (m as { chargeback_count: number | null }).chargeback_count ?? 0;
  }

  return NextResponse.json({
    recommendation: {
      recommendedPlan: recommendedPlan as PlanId,
      monthlyChargebacks: Number(row.monthly_chargebacks ?? 0),
      headroomMultiplier:
        row.headroom_multiplier == null ? null : Number(row.headroom_multiplier),
      reason: row.reason as string,
      partialHistory: !!row.partial_history,
    },
    show: shouldShowRecommendationBanner(recommendedPlan, dismissedPlan),
    ordersAnalyzed,
    chargebackCount90d,
  });
}
