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

export interface CheckpointInput {
  /** 90-day chargeback rate as a percent (e.g. 0.7 = 0.7%). */
  chargebackRate90d: number | null;
  /** 90-day CHARGEBACK count — needed for the ECM rule, which requires
   *  both the ratio AND 100+ disputes/month.
   *
   *  Named `...Count...`, not `...Orders...`, deliberately. The field was
   *  previously `chargebackOrders90d`, which reads like an order count —
   *  and the in-app page duly passed the order denominator, so a merchant
   *  with 14,635 orders and 300 chargebacks was told they average ~4,878
   *  chargebacks a month against a true ~100 (49x). The two digests passed
   *  the correct value, so the same merchant saw contradictory figures in
   *  the app and in their email. The name is the fix: a count and a
   *  denominator must not share one. */
  chargebackCount90d: number;
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

export interface Checkpoint {
  /** Stable rule id — also the i18n namespace key suffix. */
  id: string;
  severity: CheckpointSeverity;
  /** i18n key for the title line. */
  titleKey: string;
  /** i18n key for the body line. */
  bodyKey: string;
  /** Interpolation values for both title and body keys. */
  values: Record<string, string | number>;
  /** Citation surfaced under the body — public URL + short label. */
  source?: { label: string; url: string };
}
