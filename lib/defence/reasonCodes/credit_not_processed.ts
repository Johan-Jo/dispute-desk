/**
 * Reason-code module: Visa 13.6 / Mastercard 4860 — Credit Not Processed.
 *
 * Cardholder claims a refund/credit owed to them was never applied.
 * Merchant must show whether a refund was processed, was not owed under
 * policy, or that timing/communication addresses the cardholder's claim.
 */

import type { ReasonCodeGuidance } from "../types";

export const credit_not_processed: ReasonCodeGuidance = {
  key: "credit_not_processed",
  displayName: "Visa 13.6 / Mastercard 4860",
  claimType: "Credit not processed claim",
  reasonCodeKeys: ["13.6", "4860"],
  promptBody: [
    "You are writing a bank-facing response to a CREDIT NOT PROCESSED CLAIM (cardholder alleges a refund or credit owed to them was never applied). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise: refund status, refund timeline, cancellation terms, partial refund records, store credit records, customer communication about the refund.",
    "Do NOT claim a refund was issued unless an approved refund_record fact carries refundStatus='processed'.",
    "If no refund was owed under policy, cite the approved refund policy fact (acceptedAtCheckout=true) explicitly.",
    "When a no_return_initiated fact is present (no refund was issued AND the customer never initiated a return), you may argue the refund was not owed because the goods were never returned — cite the return status factually.",
  ].join("\n"),
  prioritize: [
    "refund_record",
    "no_return_initiated",
    "policy_refund",
    "policy_cancellation",
    "customer_communication",
    "order_record",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "no refund was ever owed",
    "definitive proof of refund",
    "the cardholder is lying about the refund",
  ],
  criticalCategories: ["refund_record"],
  allowedFactCategories: [
    // Admitted since `product_description` split out of `order_record`
    // (2026-09-01). Ranking is unchanged here — only `product_unacceptable`
    // promotes it — but the fact stays as citable as it was before.
    "product_listing",
    "refund_record",
    "no_return_initiated",
    "policy_refund",
    "policy_cancellation",
    "policy_acceptance",
    "customer_communication",
    "communication",
    "order_record",
    "manual_evidence",
  ],
  version: 2,
};
