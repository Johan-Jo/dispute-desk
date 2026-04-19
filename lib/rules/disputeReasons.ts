/**
 * Canonical Shopify Payments dispute reason codes (GraphQL enum values).
 *
 * DISPUTE_REASONS_ORDER — the 7 most common reasons, used in the merchant
 * setup wizard. DO NOT expand this without updating the setup automation
 * validation at /api/setup/automation (which requires all entries present).
 *
 * ALL_DISPUTE_REASONS — the full 14 Shopify dispute reason codes, used in
 * the internal admin reason mapping system. Safe to expand.
 */
export const DISPUTE_REASONS_ORDER = [
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "SUBSCRIPTION_CANCELED",
  "PRODUCT_UNACCEPTABLE",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE",
  "GENERAL",
] as const;

export type DisputeReasonCode = (typeof DISPUTE_REASONS_ORDER)[number];

/**
 * Full set of Shopify dispute reason codes — used by the internal admin
 * reason-to-template mapping system. Includes all 14 possible reasons.
 */
export const ALL_DISPUTE_REASONS = [
  "BANK_CANNOT_PROCESS",
  "CREDIT_NOT_PROCESSED",
  "CUSTOMER_INITIATED",
  "DEBIT_NOT_AUTHORIZED",
  "DUPLICATE",
  "FRAUDULENT",
  "GENERAL",
  "INCORRECT_ACCOUNT_DETAILS",
  "INSUFFICIENT_FUNDS",
  "NONCOMPLIANT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELED",
  "UNRECOGNIZED",
] as const;

export type AllDisputeReasonCode = (typeof ALL_DISPUTE_REASONS)[number];

/** Human-friendly labels for all 14 Shopify dispute reasons. */
export const DISPUTE_REASON_LABELS: Record<AllDisputeReasonCode, string> = {
  BANK_CANNOT_PROCESS: "Bank Cannot Process",
  CREDIT_NOT_PROCESSED: "Credit Not Processed",
  CUSTOMER_INITIATED: "Customer Initiated",
  DEBIT_NOT_AUTHORIZED: "Debit Not Authorized",
  DUPLICATE: "Duplicate",
  FRAUDULENT: "Fraudulent",
  GENERAL: "General",
  INCORRECT_ACCOUNT_DETAILS: "Incorrect Account Details",
  INSUFFICIENT_FUNDS: "Insufficient Funds",
  NONCOMPLIANT: "Noncompliant",
  PRODUCT_NOT_RECEIVED: "Product Not Received",
  PRODUCT_UNACCEPTABLE: "Product Unacceptable",
  SUBSCRIPTION_CANCELED: "Subscription Canceled",
  UNRECOGNIZED: "Unrecognized",
};

/**
 * Merchant-facing labels for dispute reasons. Use in customer-visible
 * UI (page titles, summaries, alerts). Plain English, not enum-style.
 */
export const MERCHANT_DISPUTE_REASON_LABELS: Record<AllDisputeReasonCode, string> = {
  BANK_CANNOT_PROCESS: "Bank could not process",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  CUSTOMER_INITIATED: "Customer-initiated dispute",
  DEBIT_NOT_AUTHORIZED: "Debit not authorized",
  DUPLICATE: "Duplicate charge",
  FRAUDULENT: "Unauthorized transaction",
  GENERAL: "General dispute",
  INCORRECT_ACCOUNT_DETAILS: "Incorrect account details",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  NONCOMPLIANT: "Noncompliant transaction",
  PRODUCT_NOT_RECEIVED: "Item not received",
  PRODUCT_UNACCEPTABLE: "Item not as described",
  SUBSCRIPTION_CANCELED: "Subscription canceled",
  UNRECOGNIZED: "Unrecognized charge",
};

/** Resolve a Shopify dispute reason to its merchant-facing label. */
export function merchantDisputeReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "Dispute";
  const key = reason.toUpperCase().replace(/\s+/g, "_") as AllDisputeReasonCode;
  return MERCHANT_DISPUTE_REASON_LABELS[key] ?? "Dispute";
}

/** Family groupings for all 14 dispute reasons. */
export const DISPUTE_REASON_FAMILIES: Record<AllDisputeReasonCode, string> = {
  BANK_CANNOT_PROCESS: "Technical",
  CREDIT_NOT_PROCESSED: "Refund",
  CUSTOMER_INITIATED: "General",
  DEBIT_NOT_AUTHORIZED: "Authorization",
  DUPLICATE: "Billing",
  FRAUDULENT: "Fraud",
  GENERAL: "General",
  INCORRECT_ACCOUNT_DETAILS: "Technical",
  INSUFFICIENT_FUNDS: "Billing",
  NONCOMPLIANT: "Compliance",
  PRODUCT_NOT_RECEIVED: "Fulfillment",
  PRODUCT_UNACCEPTABLE: "Quality",
  SUBSCRIPTION_CANCELED: "Subscription",
  UNRECOGNIZED: "Fraud",
};

/** Dispute phases — inquiry is review-first triage, chargeback is evidence-defense. */
export const DISPUTE_PHASES = ["inquiry", "chargeback"] as const;
export type DisputePhase = (typeof DISPUTE_PHASES)[number];
