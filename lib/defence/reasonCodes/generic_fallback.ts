/**
 * Reason-code module: generic fallback.
 *
 * Used when the network reason code is unknown, unmapped, or outside the
 * specific reason codes we model. Provides conservative defaults that
 * accommodate any of the canonical signals without overfitting to a
 * specific scheme rule.
 */

import type { ReasonCodeGuidance } from "../types";

export const generic_fallback: ReasonCodeGuidance = {
  key: "generic_fallback",
  displayName: "Generic representment",
  claimType: "Unmapped chargeback claim",
  reasonCodeKeys: [],
  promptBody: [
    "You are writing a bank-facing representment for a chargeback whose specific reason code is unknown.",
    "Argue from the approved facts only. Do not invent scheme-specific rules.",
    "Cite the strongest available approved facts: payment authentication if present, delivery/access if present, order record consistency, customer communication, policy disclosures.",
    "Avoid aggressive conclusions. Use hedged framing: 'The available evidence supports…', 'The available records indicate…'.",
  ].join("\n"),
  prioritize: [
    "payment_authentication",
    "billing_match",
    "delivery_proof",
    "shipping_tracking",
    "customer_communication",
    "order_record",
    "policy_refund",
    "policy_shipping",
    "policy_cancellation",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "the dispute is invalid",
    "definitive proof",
    "the cardholder is lying",
  ],
  criticalCategories: ["order_record"],
  allowedFactCategories: [
    // Admitted since `product_description` split out of `order_record`
    // (2026-09-01). Ranking is unchanged here — only `product_unacceptable`
    // promotes it — but the fact stays as citable as it was before.
    "product_listing",
    "payment_authentication",
    "payment_auth",
    "billing_match",
    "delivery_proof",
    "shipping_tracking",
    "digital_access_log",
    "service_access",
    "customer_communication",
    "communication",
    "policy_refund",
    "policy_shipping",
    "policy_cancellation",
    "policy_acceptance",
    "refund_record",
    "duplicate_explanation",
    "subscription_terms",
    "order_record",
    "prior_customer_history",
    "account_history",
    "manual_evidence",
  ],
  version: 3,
};
