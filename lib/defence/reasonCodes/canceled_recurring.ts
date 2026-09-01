/**
 * Reason-code module: Visa 13.2 / Mastercard 4841 — Cancelled Recurring.
 *
 * Cardholder claims a subscription/recurring charge was billed after
 * cancellation. Merchant must show the subscription terms, cancellation
 * timeline, and customer consent.
 */

import type { ReasonCodeGuidance } from "../types";

export const canceled_recurring: ReasonCodeGuidance = {
  key: "canceled_recurring",
  displayName: "Visa 13.2 / Mastercard 4841",
  claimType: "Cancelled recurring transaction claim",
  reasonCodeKeys: ["13.2", "4841"],
  promptBody: [
    "You are writing a bank-facing response to a CANCELLED RECURRING TRANSACTION CLAIM (cardholder alleges a recurring charge was billed after cancellation). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise: subscription terms, cancellation policy, renewal notice, customer consent at sign-up, cancellation timing, service usage records after renewal.",
    "Do NOT argue the customer used the service after cancellation unless an approved service_access fact carries timestamps after the disputed charge.",
    "Do NOT cite the cancellation policy unless an approved policy_cancellation fact exists.",
  ].join("\n"),
  prioritize: [
    "subscription_terms",
    "policy_cancellation",
    "policy_acceptance",
    "service_access",
    "customer_communication",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "the customer never cancelled",
    "definitive proof of consent",
    "the cardholder is lying about cancellation",
  ],
  criticalCategories: ["subscription_terms", "policy_cancellation"],
  allowedFactCategories: [
    // Admitted since `product_description` split out of `order_record`
    // (2026-09-01). Ranking is unchanged here — only `product_unacceptable`
    // promotes it — but the fact stays as citable as it was before.
    "product_listing",
    "subscription_terms",
    "policy_cancellation",
    "policy_acceptance",
    "service_access",
    "customer_communication",
    "communication",
    "order_record",
    "manual_evidence",
  ],
  version: 3,
};
