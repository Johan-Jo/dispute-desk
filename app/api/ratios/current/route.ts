import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  MC_ECM_COUNT_FLOOR,
  MC_ECM_RATIO,
  VAMP_COUNT_FLOOR,
  VAMP_EARLY_WARNING,
  VAMP_EXCESSIVE,
} from "@/lib/insights/programmeThresholds";
import { programmeMonthFor } from "@/lib/insights/period/computeProgrammeBlock";
import { statementMonth } from "@/lib/insights/period/months";

export const runtime = "nodejs";

/**
 * GET /api/ratios/current
 *
 * The Liability-shift card's figures for the statement month (the last
 * complete calendar month) — computed by the same `computeProgrammeBlock`
 * the Insights checkpoints use, so the two VAMP numbers on that page are one
 * number. It used to read the newest `ratio_snapshots` row, which is the
 * CURRENT, unfinished month (Mein Maison: 1 dispute on 32 October orders
 * shown as 3.13% VAMP in red), and turned NULL into 0.
 *
 * The DisputeDesk-impact counts (CE 3.0 / FPT exclusions, fees avoided)
 * still come from that month's snapshot row. Always labelled "calculated
 * estimate" client-side.
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
  const now = new Date();
  const month = statementMonth(now);

  const programme = await programmeMonthFor(sb, shopId, month, now);
  if (programme.status === "error") {
    return NextResponse.json({ snapshot: null, status: "error", periodMonth: month });
  }

  const { data: row, error } = await sb
    .from("ratio_snapshots")
    .select(
      "vamp_ratio_without_dd, ce30_excluded_count, fpt_excluded_count, estimated_fees_avoided_usd, estimated_revenue_recovered_usd, calculated_at",
    )
    .eq("shop_id", shopId)
    .eq("period_month", month)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ snapshot: null, status: "error", periodMonth: month });
  }

  const num = (v: unknown): number | null =>
    v === null || v === undefined ? null : Number(v);

  return NextResponse.json({
    status: "ok",
    snapshot: {
      periodMonth: month,
      periodState: programme.periodState,
      finalOn: programme.finalOn,
      cardFramingApplies: programme.cardFramingApplies,
      vamp: {
        ratio: programme.cardDisputeRatio,
        ratioWithoutDd: num(row?.vamp_ratio_without_dd),
        severity: programme.vampSeverity,
        count: programme.visaChargebackCount,
        countFloor: VAMP_COUNT_FLOOR,
        thresholdEarlyWarning: VAMP_EARLY_WARNING,
        thresholdExcessive: VAMP_EXCESSIVE,
      },
      mcEcm: {
        ratio: programme.ecmRatio,
        severity: programme.ecmSeverity,
        lowerBound: programme.ecmIsLowerBound,
        count: programme.mcChargebackCount,
        countFloor: MC_ECM_COUNT_FLOOR,
        threshold: MC_ECM_RATIO,
      },
      impact: {
        ce30ExcludedCount: Number(row?.ce30_excluded_count ?? 0),
        fptExcludedCount: Number(row?.fpt_excluded_count ?? 0),
        estimatedFeesAvoidedUsd: Number(row?.estimated_fees_avoided_usd ?? 0),
        estimatedRevenueRecoveredUsd: Number(row?.estimated_revenue_recovered_usd ?? 0),
      },
      calculatedAt: (row?.calculated_at as string | null) ?? null,
    },
  });
}
