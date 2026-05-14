import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  bandForVamp,
  bandForMcEcm,
  bandForMcEfm,
  VAMP_STANDARD,
  VAMP_EXCESSIVE,
  MC_ECM,
  MC_EFM,
} from "@/lib/liabilityShift/ratios/thresholds";

export const runtime = "nodejs";

/**
 * GET /api/ratios/current
 *
 * Returns the most recent calculated ratio snapshot for the shop,
 * with threshold bands and the counterfactual delta. Always labeled
 * "calculated estimate" client-side.
 */
export async function GET(req: NextRequest) {
  const shopId = extractShopId(req);
  if (!shopId || shopId === "demo") {
    return NextResponse.json(
      { error: "Shop context required.", code: "SHOP_CONTEXT_REQUIRED" },
      { status: 401 },
    );
  }

  const sb = getServiceClient();
  const { data, error } = await sb
    .from("ratio_snapshots")
    .select("*")
    .eq("shop_id", shopId)
    .order("period_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ snapshot: null });
  }

  return NextResponse.json({
    snapshot: {
      periodMonth: data.period_month,
      vamp: {
        ratio: Number(data.vamp_ratio_calculated ?? 0),
        ratioWithoutDd: Number(data.vamp_ratio_without_dd ?? 0),
        band: bandForVamp(Number(data.vamp_ratio_calculated ?? 0)),
        thresholdStandard: VAMP_STANDARD,
        thresholdExcessive: VAMP_EXCESSIVE,
      },
      mcEcm: {
        ratio: Number(data.mc_ecm_ratio ?? 0),
        band: bandForMcEcm(Number(data.mc_ecm_ratio ?? 0)),
        threshold: MC_ECM,
      },
      mcEfm: {
        ratio: Number(data.mc_efm_ratio ?? 0),
        band: bandForMcEfm(Number(data.mc_efm_ratio ?? 0)),
        threshold: MC_EFM,
      },
      impact: {
        ce30ExcludedCount: Number(data.ce30_excluded_count ?? 0),
        fptExcludedCount: Number(data.fpt_excluded_count ?? 0),
        estimatedFeesAvoidedUsd: Number(data.estimated_fees_avoided_usd ?? 0),
        estimatedRevenueRecoveredUsd: Number(
          data.estimated_revenue_recovered_usd ?? 0,
        ),
      },
      calculatedAt: data.calculated_at,
    },
  });
}
