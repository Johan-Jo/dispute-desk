/**
 * Reason-code module: Visa 12.6 / Mastercard 4834 — Duplicate Processing.
 *
 * Cardholder claims they were charged twice for the same transaction.
 * Merchant must show the transactions are distinct or that any duplicate
 * has been refunded.
 */

import type { ReasonCodeGuidance } from "../types";

export const duplicate_processing: ReasonCodeGuidance = {
  key: "duplicate_processing",
  displayName: "Visa 12.6 / Mastercard 4834",
  claimType: "Duplicate processing claim",
  reasonCodeKeys: ["12.6", "4834"],
  promptBody: [
    "You are writing a bank-facing response to a DUPLICATE PROCESSING CLAIM (cardholder alleges they were charged twice for the same transaction). The reason code is the issuer/cardholder's CLAIM CATEGORY, not a merchant admission.",
    "Prioritise: unique order ids, unique authorisation/capture ids, distinct timestamps, distinct items/quantities, refund records when one of the transactions was reversed.",
    "Frame the argument around the distinctness of the transactions, citing each order/auth id approved fact explicitly.",
    "Do NOT claim the duplicate was refunded unless an approved refund_record fact supports it.",
  ].join("\n"),
  prioritize: [
    "order_record",
    "duplicate_explanation",
    "refund_record",
    "customer_communication",
  ],
  avoid: [
    "ip_location",
    "device_session",
    "fraud_screening",
  ],
  mustNotClaim: [
    "the cardholder is lying about the duplicate",
    "definitive proof of distinctness",
  ],
  criticalCategories: ["order_record"],
  allowedFactCategories: [
    // Admitted since `product_description` split out of `order_record`
    // (2026-09-01). Ranking is unchanged here — only `product_unacceptable`
    // promotes it — but the fact stays as citable as it was before.
    "product_listing",
    "order_record",
    "duplicate_explanation",
    "refund_record",
    "customer_communication",
    "communication",
    "billing_match",
    "manual_evidence",
  ],
  version: 2,
};
