/**
 * Risk-weakness gate (Phase 2 of fraud-risk incorporation).
 *
 * Detects fulfilled fraud-family disputes that Shopify flagged as
 * HIGH-risk at checkout. When triggered:
 *   - case strength is CAPPED at "moderate" (never elevated)
 *   - the merchant-facing strength reason explains the cap
 *   - the existing auto + moderate → park_for_review branch handles
 *     routing; no new pipeline gate is required
 *
 * # Hard rules
 *
 * 1. **Cap, never block.** A HIGH-risk order with strong delivery, AVS,
 *    or authentication evidence is still defensible. Auto-blocking
 *    would over-trigger. The cap forces merchant review without
 *    refusing the case.
 *
 * 2. **Fraud-family only.** Risk-weakness applies only to FRAUDULENT /
 *    UNRECOGNIZED disputes. Pre-auth fraud screening is irrelevant to
 *    PRODUCT_NOT_RECEIVED / DUPLICATE / etc. — extending scope would
 *    require revisiting the strength engine's family-specific scoring.
 *
 * 3. **NEVER cited in bank text, evidence PDF, or Shopify mutations.**
 *    This is a merchant-UI-only signal. Citing "Shopify flagged this
 *    order as high-risk" in a rebuttal would be a confession of
 *    weakness — same logic as the fatal-loss gate.
 *
 * 4. **Cap is a ceiling, not a floor.** If the underlying case is
 *    already Moderate or Weak, the cap is a no-op. The cap only fires
 *    when scoring would otherwise have produced "strong".
 *
 * 5. **No re-fetch.** Reads only the persisted `risk_level_initial` /
 *    `risk_recommendation_initial` snapshot from `shopify_orders`,
 *    populated by the orders backfill ingestion.
 *
 * TODO v2: when 3-D Secure liability shift is verified
 * (`tdsVerified === true` from manual confirmation), the cap should be
 * overridden — the network has explicitly transferred liability and
 * pre-auth risk score is no longer relevant. Not implemented in v1.
 */

import { isFraudFamilyReason } from "@/lib/disputes/networkReasonCode";

export type RiskWeaknessReason = "high_risk_fulfilled";

export interface RiskWeaknessSummary {
  /** True when the cap should apply. */
  triggered: boolean;
  /** Why the cap fired. Null when not triggered. */
  reason: RiskWeaknessReason | null;
  /** Merchant-facing one-liner. Surfaced via strengthReason ONLY when
   *  the cap actually changes the verdict (i.e. underlying strength
   *  would have been "strong"). Never reaches bank text. */
  message: string | null;
  /** Shopify's snapshot risk indicators — diagnostic only, persisted to
   *  pack_json for audit. Never rendered in bank text, evidence PDF, or
   *  Shopify mutation payloads. */
  diagnostics: {
    riskLevel: string | null;
    recommendation: string | null;
    fulfillmentCount: number;
  };
}

const NOT_TRIGGERED = (
  riskLevel: string | null,
  recommendation: string | null,
  fulfillmentCount: number,
): RiskWeaknessSummary => ({
  triggered: false,
  reason: null,
  message: null,
  diagnostics: { riskLevel, recommendation, fulfillmentCount },
});

const HIGH_RISK_FULFILLED_MESSAGE =
  "Shopify's pre-authorization fraud screening flagged this order as high-risk before fulfillment. Your case can still be defended, but please review the evidence carefully before submitting.";

/** Shopify recommendations that indicate the merchant was advised
 *  against fulfilling. NONE / ACCEPT are non-warnings. */
const WARNING_RECOMMENDATIONS = new Set<string>(["INVESTIGATE", "REJECT"]);

export interface RiskWeaknessInput {
  /** Shopify dispute reason code (e.g. FRAUDULENT, UNRECOGNIZED). */
  disputeReason: string | null;
  /** Persisted snapshot from `shopify_orders.risk_level_initial`. */
  riskLevelInitial: string | null;
  /** Persisted snapshot from `shopify_orders.risk_recommendation_initial`. */
  riskRecommendationInitial: string | null;
  /** Number of fulfillments on the order. The merchant "fulfilled
   *  anyway" condition requires >= 1. */
  fulfillmentCount: number;
}

/**
 * Detect risk-weakness conditions. Pure — no I/O, deterministic.
 *
 * The function returns a populated `diagnostics` block even when not
 * triggered, so callers can persist the snapshot for audit regardless
 * of whether the cap fired. The cap itself is applied by the case-
 * strength engine when `triggered === true`.
 */
export function detectRiskWeakness(args: RiskWeaknessInput): RiskWeaknessSummary {
  const riskLevel = normalizeUpper(args.riskLevelInitial);
  const recommendation = normalizeUpper(args.riskRecommendationInitial);
  const fulfillmentCount = Math.max(0, args.fulfillmentCount | 0);

  // Rule 2: fraud-family only.
  if (!isFraudFamilyReason(args.disputeReason)) {
    return NOT_TRIGGERED(riskLevel, recommendation, fulfillmentCount);
  }

  // Trigger: HIGH risk + warning recommendation + merchant fulfilled.
  if (riskLevel !== "HIGH") {
    return NOT_TRIGGERED(riskLevel, recommendation, fulfillmentCount);
  }
  if (!recommendation || !WARNING_RECOMMENDATIONS.has(recommendation)) {
    return NOT_TRIGGERED(riskLevel, recommendation, fulfillmentCount);
  }
  if (fulfillmentCount < 1) {
    return NOT_TRIGGERED(riskLevel, recommendation, fulfillmentCount);
  }

  // TODO v2: when tdsVerified === true from manual confirmation, skip
  // the cap. The network has transferred liability via 3DS and the
  // pre-auth risk score is no longer the dominant signal.

  return {
    triggered: true,
    reason: "high_risk_fulfilled",
    message: HIGH_RISK_FULFILLED_MESSAGE,
    diagnostics: {
      riskLevel,
      recommendation,
      fulfillmentCount,
    },
  };
}

function normalizeUpper(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = String(v).trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}
