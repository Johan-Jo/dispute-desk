/**
 * Visa VAMP + Mastercard ECM / EFM threshold constants.
 *
 * Sources:
 *   - Visa VAMP fact sheet (standard 0.65% / excessive 1.50%)
 *   - Mastercard ECM (Excessive Chargeback Merchant) 1.00%
 *   - Mastercard EFM (Excessive Fraud Merchant) 0.50%
 *
 * Encoded as data so calibrating against rule changes is a config
 * tweak. Per LSE-5 epic acceptance criteria.
 */

export const VAMP_STANDARD = 0.0065; // 0.65%
export const VAMP_EXCESSIVE = 0.015; // 1.50%
export const MC_ECM = 0.01; // 1.00%
export const MC_EFM = 0.005; // 0.50%

export const YELLOW_BAND_FACTOR = 0.8; // 80% of standard threshold triggers yellow.

export type RatioBand = "green" | "yellow" | "red";

export function bandForVamp(ratio: number): RatioBand {
  if (ratio >= VAMP_EXCESSIVE) return "red";
  if (ratio >= VAMP_STANDARD) return "red"; // standard breach is red too — both are bad
  if (ratio >= VAMP_STANDARD * YELLOW_BAND_FACTOR) return "yellow";
  return "green";
}

export function bandForMcEcm(ratio: number): RatioBand {
  if (ratio >= MC_ECM) return "red";
  if (ratio >= MC_ECM * YELLOW_BAND_FACTOR) return "yellow";
  return "green";
}

export function bandForMcEfm(ratio: number): RatioBand {
  if (ratio >= MC_EFM) return "red";
  if (ratio >= MC_EFM * YELLOW_BAND_FACTOR) return "yellow";
  return "green";
}

/** Visa per-VAMP-enforcement-transaction fee. Encoded as data — update on Visa fact-sheet revisions. */
export const VAMP_PER_TRANSACTION_FEE_USD = 8.0;
