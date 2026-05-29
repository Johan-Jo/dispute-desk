/**
 * Plan recommendation engine — fits the right tier to a shop's
 * historical chargeback volume.
 *
 * Designed for first-install merchants who land on Free by default
 * (see `app/api/billing/checkQuota.ts:27` — null plan coalesces to
 * "free"). Once the 90-day historical import completes, the Risk
 * Intelligence page proposes a tier that covers their volume with
 * headroom. The merchant stays on Free until they accept.
 *
 * Thresholds (monthly chargebacks):
 *   0       → free          (no signal yet OR truly low volume)
 *   1–14    → starter       (20 packs/mo cap — modest headroom)
 *   15–70   → growth        (100 packs/mo cap — sweet spot)
 *   71+     → scale         (400 packs/mo cap — volume demands it)
 *
 * Spike protection: monthlyChargebacks = max(90d/3, 30d). A shop that
 * had a quiet 60 days and a noisy 30 should be sized to the noisy
 * window — chargebacks cluster, and under-sizing means the merchant
 * hits the pack cap mid-month.
 *
 * Pure function. No I/O, no token resolution, no English strings.
 * Reason discriminator is a structural enum; UI maps it to localized
 * copy at the leaf renderer.
 */

import { PLANS, type PlanId } from "./plans";

export type RecommendationReason =
  | "no_history"      // ordersAnalyzed === 0 — nothing to base a recommendation on yet
  | "low_volume"      // had orders, no chargebacks — Free still fits
  | "volume_fits"     // 90-day average drives the recommendation
  | "spike_observed"; // 30-day count materially above the 90-day average

export interface PlanRecommendationInput {
  chargebackOrders90d: number;
  chargebackOrders30d: number;
  ordersAnalyzed: number;
  historicalScopeGranted: "default_window" | "read_all_orders" | null;
}

export interface PlanRecommendation {
  recommendedPlan: PlanId;
  /** Monthly chargeback rate used for the sizing decision. Rounded to
   *  one decimal. Driven by max(90d/3, 30d). */
  monthlyChargebacks: number;
  /** packsPerMonth cap ÷ monthlyChargebacks. Null when Free was
   *  recommended (Free uses lifetime, not monthly — ratio is N/A). */
  headroomMultiplier: number | null;
  reason: RecommendationReason;
  /** True when historicalScopeGranted === "default_window" — the
   *  import only covered Shopify's default ~60-day window. UI should
   *  flag the recommendation as based on partial history. */
  partialHistory: boolean;
}

/** Threshold for declaring a spike: 30d count must exceed 1.5× the
 *  smoothed (90d/3) rate AND clear an absolute floor of 3 events.
 *  Without the floor, going from 1 chargeback in a quiet 90d window
 *  to 2 in the recent 30d trips a "spike" that isn't statistically
 *  interesting. */
const SPIKE_MULTIPLIER = 1.5;
const SPIKE_FLOOR = 3;

export function recommendPlan(input: PlanRecommendationInput): PlanRecommendation {
  const {
    chargebackOrders90d,
    chargebackOrders30d,
    ordersAnalyzed,
    historicalScopeGranted,
  } = input;

  const smoothed = chargebackOrders90d / 3;
  const monthlyChargebacks = Math.max(smoothed, chargebackOrders30d);
  const partialHistory = historicalScopeGranted === "default_window";
  const spikeObserved =
    chargebackOrders30d > smoothed * SPIKE_MULTIPLIER &&
    chargebackOrders30d >= SPIKE_FLOOR;

  if (monthlyChargebacks === 0) {
    return {
      recommendedPlan: "free",
      monthlyChargebacks: 0,
      headroomMultiplier: null,
      reason: ordersAnalyzed === 0 ? "no_history" : "low_volume",
      partialHistory,
    };
  }

  const recommendedPlan: PlanId =
    monthlyChargebacks <= 14 ? "starter" :
    monthlyChargebacks <= 70 ? "growth" :
                               "scale";

  const cap = PLANS[recommendedPlan].packsPerMonth;
  const headroomMultiplier = Math.round((cap / monthlyChargebacks) * 10) / 10;

  return {
    recommendedPlan,
    monthlyChargebacks: Math.round(monthlyChargebacks * 10) / 10,
    headroomMultiplier,
    reason: spikeObserved ? "spike_observed" : "volume_fits",
    partialHistory,
  };
}
