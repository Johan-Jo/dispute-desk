/**
 * What a month's bar stands for on the Chargeback Exposure chart.
 *
 * - `cards`: the card dispute ratio the networks judge (a fraction).
 * - `all`: the NUMBER of chargebacks on every payment method.
 *
 * The all-methods value is a count so that it can never read below the card
 * chargebacks it contains (see readTrend.ts). `null` means the month has no
 * figure on that view; it is never drawn as zero.
 */

import type { TrendPoint } from "./readTrend";

export type TrendScope = "all" | "cards";

export function trendBarValue(point: TrendPoint, scope: TrendScope): number | null {
  if (scope === "cards") return point.cardDisputeRatio;
  return point.allChargebackCount ?? null;
}

/** Whether any month carries the all-method figures. */
export function hasAllMethods(trend: TrendPoint[]): boolean {
  return trend.some((x) => x.allChargebackCount !== null && x.allChargebackCount !== undefined);
}
