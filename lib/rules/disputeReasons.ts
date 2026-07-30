/**
 * Canonical Shopify Payments dispute reason codes (GraphQL enum values).
 *
 * DISPUTE_REASONS_ORDER — the 7 most common reasons, used in the merchant
 * setup wizard. DO NOT expand this without updating the setup automation
 * validation at /api/setup/automation (which requires all entries present).
 *
 * ALL_DISPUTE_REASONS — the full 14 Shopify dispute reason codes, used in
 * the internal admin reason mapping system. Safe to expand.
 *
 * ## Every value here MUST exist in Shopify's `ShopifyPaymentsDisputeReason`
 *
 * We invented `SUBSCRIPTION_CANCELED` (single L). Shopify only ever sends
 * `SUBSCRIPTION_CANCELLED` (double L) — verified against the Admin GraphQL
 * enum on 2026-07-28, and against 17 live prod disputes carrying the double-L
 * spelling. Because every consumer degrades silently (`?? "general"`,
 * `?? REASON_TEMPLATES.GENERAL`), the mistake was invisible: subscription
 * disputes were scored as `general`, got the GENERAL evidence checklist (which
 * never asks for the cancellation policy), and resolved to no template at all.
 *
 * `lib/rules/__tests__/shopifyReasonEnum.test.ts` now fails the build if any
 * hardcoded reason key drifts outside the enum again. When a reason code is
 * needed as a map key ANYWHERE, key it on the canonical value and run legacy
 * input through `canonicalReasonCode()` — never add a second spelling.
 */
export const DISPUTE_REASONS_ORDER = [
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "SUBSCRIPTION_CANCELLED",
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
  "SUBSCRIPTION_CANCELLED",
  "UNRECOGNIZED",
] as const;

export type AllDisputeReasonCode = (typeof ALL_DISPUTE_REASONS)[number];

const ALL_DISPUTE_REASON_SET: ReadonlySet<string> = new Set(ALL_DISPUTE_REASONS);

/**
 * Spellings that appear in STORED data but are not Shopify enum values.
 * Read-only: we accept them on the way in and immediately canonicalise.
 * Never write one, never key a map on one.
 *
 *   SUBSCRIPTION_CANCELED — our own historical typo. 2 prod disputes + seed
 *     data + pre-2026-07-28 `rules.match.reason` arrays and
 *     `pack_templates.dispute_type` rows carry it.
 *   NOT_AS_DESCRIBED — legacy UI alias, never sent by Shopify
 *     (see `ALIAS_TO_DISPUTE_TYPE` in ./disputeTypes.ts).
 */
export const LEGACY_REASON_ALIASES: Readonly<Record<string, AllDisputeReasonCode>> = {
  SUBSCRIPTION_CANCELED: "SUBSCRIPTION_CANCELLED",
  NOT_AS_DESCRIBED: "PRODUCT_UNACCEPTABLE",
};

/**
 * The ONE normaliser for a dispute reason arriving from anywhere — Shopify,
 * the DB, a rule's `match.reason`, a deep link, a merchant-typed value.
 *
 * Upper-cases, collapses whitespace to underscores, then maps any legacy
 * spelling to its canonical enum value. Returns `null` for empty input or a
 * code we don't recognise, so callers keep their own fallback behaviour
 * (`?? "general"`) instead of silently matching the wrong key.
 *
 * Call this BEFORE indexing any reason-keyed map. That is what makes the
 * single-L → double-L repair a class fix rather than 22 renames waiting to
 * drift again.
 */
export function canonicalReasonCode(
  reason: string | null | undefined,
): AllDisputeReasonCode | null {
  if (!reason) return null;
  const key = reason.trim().toUpperCase().replace(/\s+/g, "_");
  if (ALL_DISPUTE_REASON_SET.has(key)) return key as AllDisputeReasonCode;
  return LEGACY_REASON_ALIASES[key] ?? null;
}

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
  SUBSCRIPTION_CANCELLED: "Subscription Cancelled",
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
  SUBSCRIPTION_CANCELLED: "Subscription cancelled",
  UNRECOGNIZED: "Unrecognized charge",
};

/** Resolve a Shopify dispute reason to its merchant-facing label. */
export function merchantDisputeReasonLabel(reason: string | null | undefined): string {
  const key = canonicalReasonCode(reason);
  if (!key) return "Dispute";
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
  SUBSCRIPTION_CANCELLED: "Subscription",
  UNRECOGNIZED: "Fraud",
};

/** Dispute phases — inquiry is review-first triage, chargeback is evidence-defense. */
export const DISPUTE_PHASES = ["inquiry", "chargeback"] as const;
export type DisputePhase = (typeof DISPUTE_PHASES)[number];
