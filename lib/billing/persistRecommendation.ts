/**
 * Persistence layer for plan recommendations (PR 2).
 *
 * The pure sizing logic lives in `recommendPlan.ts`. This module is the
 * I/O boundary: it gathers a shop's recommendation inputs from the daily
 * rollup tables (the SAME `shop_daily_metrics.chargeback_count` source the
 * Risk Intelligence endpoint sums, so the page, the dashboard banner, and
 * the monthly cron never disagree) and upserts the result into
 * `plan_recommendations`.
 *
 * Two writers call `upsertPlanRecommendation`:
 *   - the insights endpoint, on page view (immediate population);
 *   - the monthly cron, which recomputes for every Free shop.
 *
 * The upsert NEVER touches the dismissal columns — see
 * `shouldShowRecommendationBanner` for why dismissal is keyed to the plan,
 * not a timestamp.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { PlanId } from "./plans";
import type { PlanRecommendation, PlanRecommendationInput } from "./recommendPlan";

type ServiceClient = ReturnType<typeof getServiceClient>;

/** Persisted recommendation row, as the GET endpoint + banner consume it. */
export interface StoredPlanRecommendation {
  recommendedPlan: PlanId;
  monthlyChargebacks: number;
  headroomMultiplier: number | null;
  reason: string;
  partialHistory: boolean;
  dismissedPlan: string | null;
}

function utcDateNDaysAgo(days: number, now: Date): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Decide whether the dashboard banner should surface. Pure so the matrix
 * is unit-testable without a DB.
 *
 * Show when there's a paid recommendation the merchant hasn't dismissed
 * FOR THAT EXACT PLAN. Dismissing "starter" hides the banner while the
 * recommendation stays "starter"; if volume grows and the recommendation
 * becomes "growth", the dismissal no longer matches and the banner returns.
 */
export function shouldShowRecommendationBanner(
  recommendedPlan: string,
  dismissedPlan: string | null,
): boolean {
  if (recommendedPlan === "free") return false;
  return dismissedPlan !== recommendedPlan;
}

/**
 * Gather recommendation inputs for a shop from the daily rollup. Returns
 * null when the shop has no completed import (nothing to size on).
 */
export async function gatherRecommendationInputs(
  sb: ServiceClient,
  shopId: string,
  now: Date = new Date(),
): Promise<PlanRecommendationInput | null> {
  const { data: shopRow } = await sb
    .from("shops")
    .select(
      "historical_import_status, historical_import_orders_total, historical_import_scope_granted",
    )
    .eq("id", shopId)
    .maybeSingle();

  if (!shopRow || shopRow.historical_import_status !== "complete") {
    return null;
  }

  const windowStart90d = utcDateNDaysAgo(90, now);
  const windowStart30d = utcDateNDaysAgo(30, now);

  const { data: dailyRows } = await sb
    .from("shop_daily_metrics")
    .select("date, chargeback_count")
    .eq("shop_id", shopId)
    .gte("date", windowStart90d);

  const rows = (dailyRows ?? []) as Array<{
    date: string;
    chargeback_count: number | null;
  }>;

  let chargebackOrders90d = 0;
  let chargebackOrders30d = 0;
  for (const r of rows) {
    const c = r.chargeback_count ?? 0;
    chargebackOrders90d += c;
    if (r.date >= windowStart30d) chargebackOrders30d += c;
  }

  return {
    chargebackOrders90d,
    chargebackOrders30d,
    ordersAnalyzed:
      (shopRow.historical_import_orders_total as number | null) ?? 0,
    historicalScopeGranted:
      (shopRow.historical_import_scope_granted as
        | "default_window"
        | "read_all_orders"
        | null) ?? null,
  };
}

/**
 * Upsert a freshly computed recommendation. Updates only the recommendation
 * columns — the dismissal columns (`dismissed_plan`, `dismissed_at`) are
 * deliberately omitted so PostgREST's merge-duplicates resolution preserves
 * them across recomputes. Dismissal is mutated only by the dismissal API.
 */
export async function upsertPlanRecommendation(
  sb: ServiceClient,
  shopId: string,
  rec: PlanRecommendation,
  now: Date = new Date(),
): Promise<void> {
  const iso = now.toISOString();
  const { error } = await sb
    .from("plan_recommendations")
    .upsert(
      {
        shop_id: shopId,
        recommended_plan: rec.recommendedPlan,
        monthly_chargebacks: rec.monthlyChargebacks,
        headroom_multiplier: rec.headroomMultiplier,
        reason: rec.reason,
        partial_history: rec.partialHistory,
        computed_at: iso,
        updated_at: iso,
      },
      { onConflict: "shop_id" },
    );

  if (error) throw new Error(error.message);
}
