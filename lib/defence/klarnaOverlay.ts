/**
 * Klarna-specific, reason-aware narrative overlays.
 *
 * The generic BNPL overlay (`paymentOverlays.ts`) correctly strips card
 * vocabulary but is deliberately neutral — it doesn't tell the model what
 * Klarna *actually* adjudicates on. Klarna runs its own dispute process
 * with its own taxonomy and a strict evidence contract (verified against
 * docs.klarna.com, 2026-07-04):
 *
 *   - Klarna's Merchant Protection Program (MPP) requires a genuine Proof
 *     of Delivery (POD) for Goods-Not-Received: carrier, tracking, delivery
 *     date + address + recipient name; a tracking link alone is NOT
 *     sufficient. Customer signature is required for orders over 750 EUR.
 *   - Faulty / Not-as-Described leans on the resolution offered (repair /
 *     replacement / refund), the return label, and customer communication.
 *   - Incorrect Amount leans on the invoice tied to the Klarna order and a
 *     clear price/fee justification.
 *   - Refund-not-processed (Return) leans on the refund record + timing and
 *     whether a refund was actually owed.
 *   - Unauthorized Purchase leans on delivery + account/customer identity.
 *
 * These overlays inject Klarna's real evidence expectations per category so
 * the narrative foregrounds exactly what Klarna weighs — without inventing
 * a Klarna reason *code* (the Shopify-Payments-Klarna path exposes none) or
 * naming Klarna as the adjudicator in card terms. Deadlines are included as
 * context for urgency framing, not asserted as legal claims.
 *
 * The category is derived from the coarse Shopify dispute `reason` enum —
 * the only reason signal we have for a Klarna dispute.
 */

import type { KlarnaSubProduct } from "@/lib/disputes/paymentContext";

/** Klarna dispute categories we tailor for. Mapped from the Shopify reason
 *  enum; `generic` covers anything unmapped. */
export type KlarnaCategory =
  | "goods_not_received"
  | "faulty_or_not_as_described"
  | "incorrect_amount"
  | "refund_not_processed"
  | "unauthorized_purchase"
  | "generic";

/** Shopify `ShopifyPaymentsDisputeReason` → Klarna category. */
const SHOPIFY_REASON_TO_KLARNA_CATEGORY: Record<string, KlarnaCategory> = {
  PRODUCT_NOT_RECEIVED: "goods_not_received",
  PRODUCT_UNACCEPTABLE: "faulty_or_not_as_described",
  CREDIT_NOT_PROCESSED: "refund_not_processed",
  DUPLICATE: "incorrect_amount",
  SUBSCRIPTION_CANCELED: "refund_not_processed",
  FRAUDULENT: "unauthorized_purchase",
  UNRECOGNIZED: "unauthorized_purchase",
};

export function klarnaCategoryForReason(
  shopifyReason: string | null | undefined,
): KlarnaCategory {
  if (!shopifyReason) return "generic";
  return (
    SHOPIFY_REASON_TO_KLARNA_CATEGORY[shopifyReason.toUpperCase()] ?? "generic"
  );
}

/** Per-category Klarna evidence guidance (what Klarna actually weighs). */
const CATEGORY_GUIDANCE: Record<KlarnaCategory, string> = {
  goods_not_received: `Klarna category: GOODS / SERVICES NOT RECEIVED.
Klarna decides this on a genuine PROOF OF DELIVERY, not a tracking link alone.
Foreground, in this order, whatever the approved evidence supports:
  - Carrier name, tracking number, and the delivery timestamp;
  - The delivery address and that it matches the order's shipping address;
  - Recipient / signature where present (a signature materially strengthens
    the case; for higher-value orders Klarna expects one);
  - A second corroborating artifact if available (packing slip, delivery
    note, weight, pickup confirmation).
If tracking exists but delivery is NOT confirmed, state precisely what the
tracking shows (handed to carrier, in transit, last scan) and do NOT assert
delivery. Never claim delivery without an approved delivery_proof fact.`,

  faulty_or_not_as_described: `Klarna category: FAULTY / NOT AS DESCRIBED.
Klarna weighs the resolution offered and the accuracy of the listing.
Foreground: the product listing / description as advertised; any resolution
offered (repair, replacement, or refund) and its timing; return-label or
return-instructions provided; and customer communication showing the item
matched what was ordered or that a fair resolution was extended. Do not
concede a defect that the evidence does not establish.`,

  incorrect_amount: `Klarna category: INCORRECT AMOUNT / INVOICE.
Klarna weighs the invoice tied to this order against the amount charged.
Foreground: the order total and its breakdown (items, shipping, tax, fees),
that the charged amount matches the order the customer placed, and any
adjustment, partial refund, or cancellation already applied. Tie every
figure to the specific Klarna order.`,

  refund_not_processed: `Klarna category: REFUND NOT PROCESSED / RETURN.
Klarna weighs whether a refund was owed and whether it was issued.
Foreground: the refund record (status, amount, timestamp) if a refund was
issued; the return status and tracking if a return applies; the applicable
refund / return / cancellation policy the customer accepted; and whether
the customer was actually entitled to a refund. If no refund was owed, make
that case from the policy and order facts — do not imply one was withheld
in error.`,

  unauthorized_purchase: `Klarna category: UNAUTHORIZED PURCHASE.
Klarna weighs delivery and customer-identity evidence.
Foreground: proof the order was delivered to the customer's address, the
account / customer identity and order history, IP / location consistency
where available, and any customer communication acknowledging the order.
Do NOT use card-authentication constructs (they do not exist for Klarna) —
build the identity case from delivery, account, and location facts only.`,

  generic: `Klarna category: general Klarna dispute.
Klarna adjudicates on delivery, refund, and order-accuracy evidence — not
card-network signals. Lead with the concrete facts most relevant to the
stated reason and let the approved evidence stand.`,
};

/**
 * Build a Klarna-specific narrative overlay. Layers Klarna's real,
 * category-specific evidence expectations on top of the neutral BNPL frame.
 * `shopifyReason` selects the category; `subProduct` adds a one-line note
 * (pay_later vs pay_now doesn't change the evidence, but is worth stating
 * so the narrative names the correct product).
 */
export function buildKlarnaOverlay(args: {
  shopifyReason: string | null | undefined;
  subProduct?: KlarnaSubProduct | null;
}): string {
  const category = klarnaCategoryForReason(args.shopifyReason);
  const productLine =
    args.subProduct === "pay_later"
      ? "This order used Klarna Pay Later (consumer credit via Klarna)."
      : args.subProduct === "pay_now"
        ? "This order used Klarna Pay Now (immediate payment via Klarna)."
        : "This order was paid via Klarna.";

  return `PAYMENT METHOD OVERLAY — Klarna.

${productLine} This dispute is adjudicated by Klarna's own process, NOT a
card network. Do not reference card networks, card issuers, or any card
reason code. The underlying funding instrument is not available and must
never be described.

${CATEGORY_GUIDANCE[category]}

Klarna typically allows a single, time-boxed evidence submission, so the
response must be complete and lead with the strongest approved evidence.

STRICTLY FORBIDDEN (do not apply to Klarna and must never appear): AVS,
CVV/CVC, 3-D Secure / 3DS, cardholder authentication, Visa CE 3.0,
Mastercard FPT / first-party misuse tools, issuer fraud scores,
card-network liability shift, "representment", or any card-network reason
code.`;
}
