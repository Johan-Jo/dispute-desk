/**
 * Operational Checkpoints — types.
 *
 * The checkpoints engine consumes the same data shape already produced
 * by `/api/dashboard/insights/initial-analysis` and emits a sorted list
 * of observations the merchant should see surfaced as a card on the
 * Chargeback Exposure page.
 *
 * The shape is intentionally narrow — only the fields the rules
 * actually read — so the consumer (server route OR client component)
 * can pass either the full `InsightsResponse` or a slimmed projection.
 */

export type CheckpointSeverity =
  /** Within healthy band relative to network rule / own baseline. */
  | "healthy"
  /** Neutral observation — no action required, just context. */
  | "info"
  /** Operational attention recommended — not a rule breach. */
  | "consider"
  /** Actual network-threshold breach (VAMP/ECM/HECM). */
  | "breach";

/** The card-programme figures for ONE calendar month — the subset of
 *  `computeProgrammeBlock` the VAMP/ECM rules read. */
export interface ProgrammeCheckpointInput {
  /** ISO first-of-month, "YYYY-MM-01". */
  periodMonth: string;
  cardDisputeRatio: number | null;
  visaChargebackCount: number;
  mcChargebackCount: number;
  ecmRatio: number | null;
  ecmIsLowerBound: boolean;
  /** Whether card-network framing describes this merchant in this month.
   *  When false the rules emit "not applicable", never a verdict. */
  cardFramingApplies: boolean;
  /** Card share of the month's classified disputes, 0–1. */
  cardDisputeShare: number | null;
}

export interface CheckpointInput {
  /** The month's card-programme block. Absent → no VAMP/ECM checkpoint at
   *  all. A verdict from a rolling 90-day window, or from disputes counted by
   *  when we inserted them, is what told blume-box "5.31%, breach". */
  programme?: ProgrammeCheckpointInput;
  /** 30-day fraud-dispute rate as a percent. */
  fraudDisputeRatePct: number | null;
  /** % of HIGH-risk orders that were still fulfilled (last 30 days). */
  fulfilledHighRiskPct: number | null;
  /** % of Shopify Payments card orders that completed 3-DS auth. */
  threeDsAuthRatePct: number | null;
  /** % of confirmed deliveries where the carrier captured a
   *  signature. */
  signedForRatePct: number | null;
  /** % of eligible order value Shopify Protect underwrote. */
  shopifyProtectCoveragePct: number | null;
  /** Median fulfillment hours, current 30-day window. */
  medianFulfillmentHoursCurrent: number | null;
  /** Median fulfillment hours, prior 30-day window. */
  medianFulfillmentHoursPrior: number | null;
}

/** A raw value plus how to display it. Checkpoints carry raw numbers; the
 *  page and the email format them for their locale (`formatCheckpointValues`),
 *  so a stored checkpoint never freezes one language's number format. */
export type CheckpointValue =
  | string
  | number
  | { value: number; format: "pct0" | "pct1" | "pct2" | "hours" }
  | { value: string; format: "month" };

export interface Checkpoint {
  /** Stable rule id — also the i18n namespace key suffix. */
  id: string;
  severity: CheckpointSeverity;
  /** i18n key for the title line. */
  titleKey: string;
  /** i18n key for the body line. */
  bodyKey: string;
  /** Interpolation values for both title and body keys. */
  values: Record<string, CheckpointValue>;
  /** Citation surfaced under the body — public URL + short label. */
  source?: { label: string; url: string };
}
