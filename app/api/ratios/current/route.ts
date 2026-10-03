import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { extractShopId } from "@/lib/middleware/extractShopId";
import {
  MC_ECM_COUNT_FLOOR,
  MC_ECM_RATIO,
  VAMP_COUNT_FLOOR,
  VAMP_EARLY_WARNING,
  VAMP_EXCESSIVE,
  VAMP_PER_TRANSACTION_FEE_USD,
} from "@/lib/insights/programmeThresholds";
import { readProgrammeMonth } from "@/lib/insights/period/readProgrammeMonth";
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
 * Read from the stored month row (`readProgrammeMonth`), the same record
 * the checkpoints and the emails use. Always labelled "calculated estimate"
 * client-side.
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

  const programme = await readProgrammeMonth(sb, shopId, month, now);
  if (programme.status === "error") {
    return NextResponse.json({ snapshot: null, status: "error", periodMonth: month });
  }

  return NextResponse.json({
    status: "ok",
    snapshot: {
      periodMonth: month,
      periodState: programme.periodState,
      finalOn: programme.finalOn,
      cardFramingApplies: programme.cardFramingApplies,
      vamp: {
        ratio: programme.cardDisputeRatio,
        ratioWithoutDd: programme.vampRatioWithoutDd,
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
        ce30ExcludedCount: programme.ce30ExcludedCount,
        fptExcludedCount: programme.fptExcludedCount,
        estimatedFeesAvoidedUsd:
          (programme.ce30ExcludedCount + programme.fptExcludedCount) * VAMP_PER_TRANSACTION_FEE_USD,
        estimatedRevenueRecoveredUsd: programme.revenueRecoveredUsd,
      },
    },
  });
}
