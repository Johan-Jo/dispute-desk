/**
 * Klarna dispute-category labels for the defence-package PDF.
 *
 * Klarna disputes do NOT use Visa/Mastercard network reason codes — Klarna
 * runs its own dispute taxonomy (verified against Klarna's merchant docs
 * 2026-07-04). Printing "Visa 13.1 / Mastercard 4855" on a Klarna dispute
 * PDF is factually wrong and credibility-damaging to the adjudicator, and
 * the underlying funding card is structurally unavailable (Klarna is the
 * payer of record; the merchant only sees Klarna's virtual settlement card
 * via MCS). So for non-card (Klarna) disputes we display Klarna's own
 * category instead of a card reason code.
 *
 * We map from the coarse Shopify dispute `reason` enum — the only reason
 * signal we have for a Klarna dispute — to the closest Klarna category
 * label. This is a display label, NOT an invented Klarna reason *code*
 * (Klarna's Shopify-Payments path exposes no code to us).
 *
 * Klarna categories (per docs.klarna.com dispute-management):
 *   Goods/Services Not Received · Faulty or Not as Described ·
 *   Incorrect Amount · Return / Refund not processed ·
 *   Unauthorized Purchase · High-Risk Order.
 */

import { canonicalReasonCode } from "@/lib/rules/disputeReasons";

/** Shopify `ShopifyPaymentsDisputeReason` enum → Klarna category label. */
const SHOPIFY_REASON_TO_KLARNA_CATEGORY: Record<string, string> = {
  PRODUCT_NOT_RECEIVED: "Goods not received",
  PRODUCT_UNACCEPTABLE: "Faulty or not as described",
  CREDIT_NOT_PROCESSED: "Refund not processed",
  DUPLICATE: "Incorrect amount",
  SUBSCRIPTION_CANCELLED: "Return / cancellation",
  FRAUDULENT: "Unauthorized purchase",
  UNRECOGNIZED: "Unauthorized purchase",
};

/**
 * Klarna-category display label for the PDF `reasonCodeDisplay` slot.
 * Returns e.g. "Klarna dispute — Goods not received". Falls back to a
 * bare "Klarna dispute" when the Shopify reason is unknown/absent —
 * never a card network code.
 */
export function klarnaDisputeCategoryDisplay(
  shopifyReason: string | null | undefined,
): string {
  const key = canonicalReasonCode(shopifyReason);
  const category = key ? SHOPIFY_REASON_TO_KLARNA_CATEGORY[key] : undefined;
  return category ? `Klarna dispute — ${category}` : "Klarna dispute";
}
