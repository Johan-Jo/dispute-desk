/**
 * The ONE canonical dispute-type vocabulary.
 *
 * `pack_templates.dispute_type` stores Shopify's dispute reason codes
 * directly (since migration 20260411160000): `FRAUDULENT`,
 * `PRODUCT_NOT_RECEIVED`, `PRODUCT_UNACCEPTABLE`, `SUBSCRIPTION_CANCELLED`,
 * `CREDIT_NOT_PROCESSED`, `DUPLICATE`, `GENERAL`, plus `DIGITAL` (a
 * product-type signal with no Shopify equivalent).
 *
 * The template-library UI, the coverage/rules "Install Playbook" flow, and
 * the `/api/templates` route all filter on this column with
 * `.eq("dispute_type", …)`. Historically three divergent vocabularies had
 * drifted apart (UI used `FRAUD`/`REFUND`, the API used `fraud`/`credit`,
 * the DB used `FRAUDULENT`/`CREDIT_NOT_PROCESSED`), so filtered queries
 * returned zero rows and the modal fell back to fake demo cards that could
 * never install. This module is the single source of truth; a vitest
 * invariant fails the build if the UI category codes drift from it.
 */

/** The canonical `pack_templates.dispute_type` values. */
export const DISPUTE_TYPES = [
  "FRAUDULENT",
  "PRODUCT_NOT_RECEIVED",
  "PRODUCT_UNACCEPTABLE",
  "SUBSCRIPTION_CANCELLED",
  "CREDIT_NOT_PROCESSED",
  "DUPLICATE",
  "DIGITAL",
  "GENERAL",
] as const;

export type DisputeType = (typeof DISPUTE_TYPES)[number];

const DISPUTE_TYPE_SET: ReadonlySet<string> = new Set(DISPUTE_TYPES);

export function isDisputeType(value: string): value is DisputeType {
  return DISPUTE_TYPE_SET.has(value);
}

/**
 * Normalize any legacy/alias category or raw Shopify reason code to the
 * canonical `dispute_type`. Returns `undefined` for values with no mapping
 * so callers can fall through to "no filter" rather than querying a code
 * that matches nothing.
 *
 * Accepts:
 *   - canonical codes (returned as-is)
 *   - the old short UI aliases (`FRAUD`, `PNR`, `NOT_AS_DESCRIBED`,
 *     `SUBSCRIPTION`, `REFUND`) still present in deep links / bookmarks
 *   - Shopify reason codes that differ from the canonical value
 *     (`UNRECOGNIZED` → `FRAUDULENT`, `NOT_AS_DESCRIBED` →
 *     `PRODUCT_UNACCEPTABLE`)
 */
export function normalizeDisputeType(
  value: string | null | undefined
): DisputeType | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (isDisputeType(upper)) return upper;
  return ALIAS_TO_DISPUTE_TYPE[upper];
}

const ALIAS_TO_DISPUTE_TYPE: Record<string, DisputeType> = {
  // Legacy short UI aliases
  FRAUD: "FRAUDULENT",
  PNR: "PRODUCT_NOT_RECEIVED",
  NOT_AS_DESCRIBED: "PRODUCT_UNACCEPTABLE",
  SUBSCRIPTION: "SUBSCRIPTION_CANCELLED",
  REFUND: "CREDIT_NOT_PROCESSED",
  CREDIT: "CREDIT_NOT_PROCESSED",
  // Our own historical typo. Shopify's enum has only the double-L spelling;
  // stored `pack_templates.dispute_type` rows written before 2026-07-28 and
  // any bookmarked `?type=` link still carry the single-L one. Read-only —
  // never write it back. See LEGACY_REASON_ALIASES in ./disputeReasons.ts.
  SUBSCRIPTION_CANCELED: "SUBSCRIPTION_CANCELLED",
  // Shopify reason-code synonyms
  UNRECOGNIZED: "FRAUDULENT",
};
