/**
 * Canonical Shopify Payments dispute reason codes (GraphQL enum values).
 * Order defines default display order in setup automation UI.
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
