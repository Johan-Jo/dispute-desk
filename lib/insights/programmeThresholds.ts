/**
 * Card-network monitoring programmes: the ONE threshold table.
 *
 * Before 2026-10 two tables disagreed on the same page: the checkpoints used
 * Visa 0.9% / 1.5% and Mastercard 1.5%, the Liability-shift card used Visa
 * 0.65% and Mastercard 1.0%. Every VAMP/ECM number in the app now reads from
 * here (CI invariant I4: no VAMP/ECM numeric constant anywhere else).
 *
 * Ratios are fractions (0.009 = 0.9%), never percents.
 *
 * Sources (verified 2026-05-11; recheck tracked as FU-1 of
 * docs/plans/insights-single-source.plan.md):
 *   - Visa Acquirer Monitoring Program (VAMP), effective 2026-04-01: merchant
 *     Excessive at 1.5%, enforcement only from 1,500 disputes a month.
 *     0.9% is the operationally watched early-warning level.
 *   - Mastercard Excessive Chargeback Merchant (ECM): 1.5% AND 100+
 *     chargebacks a month; High ECM 3.0% AND 300+. Lagged denominator
 *     (this month's chargebacks vs last month's settled sales).
 */

import type { CheckpointSeverity } from "./checkpoints.types";

/** Bumped whenever a number or a severity rule below changes. Persisted with
 *  every evaluated month (PR2) so a past statement is never re-graded. */
export const THRESHOLDS_VERSION = "2026-10-a";

export const VAMP_EARLY_WARNING = 0.009;
export const VAMP_EXCESSIVE = 0.015;
/** Visa enforces VAMP only from this many disputes in a month. */
export const VAMP_COUNT_FLOOR = 1500;

export const MC_ECM_RATIO = 0.015;
export const MC_ECM_COUNT_FLOOR = 100;
export const MC_HECM_RATIO = 0.03;
export const MC_HECM_COUNT_FLOOR = 300;

/** Visa's per-transaction fee once Excessive is enforced. */
export const VAMP_PER_TRANSACTION_FEE_USD = 8.0;

/** Below this many card settled orders a month, no ratio is computed — one
 *  dispute would swing it by whole points (surasvenne: 1 order → "100%"). */
export const PROGRAMME_MIN_SETTLED = 50;

/**
 * VAMP severity for one calendar month.
 *
 * - below the early-warning level → healthy
 * - at or above it, enforcement floor not met → info ("above the ratio,
 *   below the enforcement floor") — never a breach a programme cannot enforce
 * - floor met → consider below Excessive, breach at or above it
 */
export function vampSeverity(ratio: number, visaCount: number): CheckpointSeverity {
  if (ratio < VAMP_EARLY_WARNING) return "healthy";
  if (visaCount < VAMP_COUNT_FLOOR) return "info";
  return ratio >= VAMP_EXCESSIVE ? "breach" : "consider";
}

/**
 * ECM severity for one calendar month.
 *
 * `lowerBound` is true while the denominator is all card orders rather than
 * Mastercard orders only (until card-brand denominators land): the true ratio
 * is then higher than shown, so a month that already meets the 100-chargeback
 * floor is at least `consider` whatever the ratio says.
 */
export function ecmSeverity(
  ratio: number,
  mcCount: number,
  lowerBound: boolean,
): CheckpointSeverity {
  if (ratio < MC_ECM_RATIO) {
    return lowerBound && mcCount >= MC_ECM_COUNT_FLOOR ? "consider" : "healthy";
  }
  if (mcCount < MC_ECM_COUNT_FLOOR) return "info";
  return "breach";
}

/** Round a ratio once, to the 5 decimals `numeric(8,5)` stores. Every surface
 *  uses this rounded value; none recomputes a ratio from counts. */
export function roundRatio(ratio: number): number {
  return Math.round(ratio * 1e5) / 1e5;
}
