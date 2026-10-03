/**
 * Demo fixture for GET /api/dashboard/insights/initial-analysis.
 *
 * Typed against the page's own contract (`satisfies`), so a change to the
 * Insights response shape fails the typecheck here instead of crashing the
 * public /demo page at runtime — the old hand-written fixture kept the
 * pre-redesign shape and `data.trend` was undefined (2026-10-03).
 */

import type { InsightsPeriod } from "@/lib/insights/period/readInsightsPeriod";
import type { TrendPoint } from "@/lib/insights/period/readTrend";
import type { LiveState } from "@/lib/insights/period/computeLiveState";

export interface DemoInsightsResponse {
  historicalImportStatus: "not_started" | "in_progress" | "complete" | "failed";
  historicalImportOrdersTotal: number;
  period: InsightsPeriod;
  trend: TrendPoint[];
  liveState: LiveState | null;
}

const MONTH = "2025-12-01";

function point(periodMonth: string, chargebacks: number, settled: number): TrendPoint {
  return {
    periodMonth,
    periodState: "final",
    cardDisputeRatio: Math.round((chargebacks / settled) * 1e5) / 1e5,
    cardChargebackCount: chargebacks,
    cardSettledCount: settled,
  };
}

export const DEMO_INSIGHTS = {
  historicalImportStatus: "complete",
  historicalImportOrdersTotal: 8432,
  period: {
    status: "ok",
    periodMonth: MONTH,
    periodState: "final",
    finalOn: "2026-01-31",
    revision: 1,
    revisedAt: null,
    programme: {
      status: "ok",
      periodState: "final",
      finalOn: "2026-01-31",
      periodMonth: MONTH,
      cardSettledCount: 1284,
      cardSettledPrevCount: 1190,
      unknownSettledCount: 22,
      cardChargebackCount: 6,
      cardFraudChargebackCount: 3,
      visaChargebackCount: 4,
      mcChargebackCount: 2,
      mcFraudChargebackCount: 1,
      unknownNetworkChargebackCount: 0,
      ce30ExcludedCount: 1,
      fptExcludedCount: 0,
      revenueRecoveredUsd: 412,
      vampRatioWithoutDd: 0.00467,
      unresolvedRailDisputeCount: 0,
      cardDisputeRatio: 0.00467,
      vampRatioCalculated: 0.00389,
      ecmRatio: 0.00168,
      ecmIsLowerBound: true,
      vampFloorMet: false,
      ecmFloorMet: false,
      vampSeverity: "healthy",
      ecmSeverity: "healthy",
      cardDisputeShare: 0.75,
      cardFramingApplies: true,
      unknownPaymentShare: 0.017,
    },
    operational: {
      threeDsShare: 0.88,
      threeDsOrders: 1094,
      threeDsEligible: 1243,
      signedForShare: 0.38,
      signedForOrders: 441,
      signedForEligible: 1160,
      protectShareByValue: 0.71,
      protectedValue: 98420,
      protectEligibleValue: 138620,
      highRiskFulfilledShare: 0.011,
      medianFulfillmentHours: 18,
      winRate: 0.6,
      wonCount: 3,
      decidedCount: 5,
      byPaymentMethod: [
        { method: "card", brand: null, isCardNetwork: true, orders: 742, chargebacks: 4, inquiries: 1, chargebackRate: 0.00539, disputeRate: 0.00674 },
        { method: "shop_pay", brand: null, isCardNetwork: true, orders: 398, chargebacks: 2, inquiries: 0, chargebackRate: 0.00503, disputeRate: 0.00503 },
        { method: "apple_pay", brand: null, isCardNetwork: true, orders: 144, chargebacks: 0, inquiries: 0, chargebackRate: 0, disputeRate: 0 },
        { method: "paypal", brand: null, isCardNetwork: false, orders: 186, chargebacks: 1, inquiries: 1, chargebackRate: 0.00538, disputeRate: 0.01075 },
        { method: "klarna", brand: null, isCardNetwork: false, orders: 61, chargebacks: 0, inquiries: 0, chargebackRate: 0, disputeRate: 0 },
      ],
    },
    checkpoints: [],
  },
  trend: [
    point("2025-07-01", 7, 1012),
    point("2025-08-01", 9, 1088),
    point("2025-09-01", 6, 1104),
    point("2025-10-01", 8, 1156),
    point("2025-11-01", 7, 1190),
    point(MONTH, 6, 1284),
  ],
  liveState: { needsAction: 2, awaitingBank: 5, nearestDueAt: "2026-01-22T00:00:00Z" },
} satisfies DemoInsightsResponse;
