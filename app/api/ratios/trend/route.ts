import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";

export const runtime = "nodejs";

/**
 * GET /api/ratios/trend?months=12
 *
 * Returns the 12-month (default) ratio series for the trend chart.
 * Includes both actual and counterfactual VAMP lines.
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }
  const months = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("months") ?? "12", 10) || 12, 1),
    36,
  );

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select(
      "period_month, vamp_ratio_calculated, vamp_ratio_without_dd, mc_ecm_ratio, mc_efm_ratio, ce30_excluded_count, fpt_excluded_count, estimated_fees_avoided_usd, estimated_revenue_recovered_usd",
    )
    .eq("shop_id", shopId)
    .order("period_month", { ascending: false })
    .limit(months);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return chronological order for chart consumption.
  const series = (data ?? []).reverse().map((row) => ({
    periodMonth: row.period_month,
    vampActual: Number(row.vamp_ratio_calculated ?? 0),
    vampWithoutDd: Number(row.vamp_ratio_without_dd ?? 0),
    mcEcm: Number(row.mc_ecm_ratio ?? 0),
    mcEfm: Number(row.mc_efm_ratio ?? 0),
    ce30Excluded: Number(row.ce30_excluded_count ?? 0),
    fptExcluded: Number(row.fpt_excluded_count ?? 0),
    feesAvoidedUsd: Number(row.estimated_fees_avoided_usd ?? 0),
    revenueRecoveredUsd: Number(row.estimated_revenue_recovered_usd ?? 0),
  }));

  return NextResponse.json({ series, months });
}
