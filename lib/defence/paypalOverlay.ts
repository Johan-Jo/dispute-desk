/**
 * PayPal-specific, reason-aware narrative overlays.
 *
 * WHY THIS EXISTS
 * ---------------
 * `paymentOverlays.ts` routed every non-card rail to one BNPL overlay whose
 * opening sentence reads "paid via a Buy-Now-Pay-Later or local payment
 * method (e.g. Klarna, Affirm)". PayPal is neither. It is a wallet, its
 * dispute process is buyer protection rather than instalment-credit
 * arbitration, and its taxonomy is its own.
 *
 * That mis-framing is not cosmetic here. Measured on prod 2026-09-01, 518 of
 * one merchant's 522 disputes are PayPal-wallet disputes settling through
 * Shopify Payments — so the generic BNPL overlay was the framing on
 * essentially that merchant's entire dispute book, telling the model the buyer
 * had used an instalment product they never used.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * It does not assert PayPal's internal adjudication rules, does not claim
 * Seller Protection eligibility (that is a fact about the case and must come
 * from evidence, not from a prompt), and does not name a card network, an
 * issuer or a reason code — a PayPal dispute has none of those. Same
 * discipline as `klarnaOverlay.ts`: frame the rail correctly, foreground the
 * evidence the stated reason actually turns on, and let the facts stand.
 *
 * The category is derived from the coarse Shopify dispute `reason` enum — the
 * only reason signal a Shopify-settled PayPal dispute exposes. PayPal's own
 * richer reason vocabulary is reachable only through the PayPal Disputes API,
 * which this path does not use.
 */

import { canonicalReasonCode } from "@/lib/rules/disputeReasons";

/** PayPal dispute categories we tailor for. Mapped from the Shopify reason
 *  enum; `generic` covers anything unmapped. */
export type PaypalCategory =
  | "item_not_received"
  | "not_as_described"
  | "refund_not_processed"
  | "unauthorized"
  | "duplicate"
  | "recurring_cancelled"
  | "generic";

/** Shopify `ShopifyPaymentsDisputeReason` → PayPal category. */
const SHOPIFY_REASON_TO_PAYPAL_CATEGORY: Record<string, PaypalCategory> = {
  PRODUCT_NOT_RECEIVED: "item_not_received",
  PRODUCT_UNACCEPTABLE: "not_as_described",
  CREDIT_NOT_PROCESSED: "refund_not_processed",
  FRAUDULENT: "unauthorized",
  UNRECOGNIZED: "unauthorized",
  DUPLICATE: "duplicate",
  SUBSCRIPTION_CANCELLED: "recurring_cancelled",
};

export function paypalCategoryForReason(
  shopifyReason: string | null | undefined,
): PaypalCategory {
  const key = canonicalReasonCode(shopifyReason);
  if (!key) return "generic";
  return SHOPIFY_REASON_TO_PAYPAL_CATEGORY[key] ?? "generic";
}

const BASE = `PAYMENT METHOD OVERLAY — PayPal wallet.

This dispute was NOT paid by card. The buyer paid with their PayPal wallet,
settling through Shopify Payments, and raised the dispute through PayPal's
buyer-protection process.

- There is no card network, no card issuer, no cardholder and no chargeback
  reason code in this dispute. Do not reference any of them, and do not frame
  the response as a card chargeback or a representment.
- Do not describe this as a Buy-Now-Pay-Later or instalment dispute. It is a
  wallet payment.
- Address the buyer's stated reason directly and let the evidence carry the
  argument. Do not assert what PayPal will conclude, and do not claim Seller
  Protection applies unless an approved fact establishes it.`;

const PER_CATEGORY: Record<PaypalCategory, string> = {
  item_not_received: `FOR THIS CLAIM (item not received) the question is whether the buyer obtained
the goods or service. Lead with: carrier and tracking number, the delivery
scan with date and destination, signature or named recipient where present,
collection or pickup record, and whether the delivery address matches the
address on the transaction. For a digital or service order, lead with access,
download, activation, attendance or usage records instead.
If tracking exists but shows no delivery, say what the tracking does show and
do not claim delivery.`,

  not_as_described: `FOR THIS CLAIM (not as described) the question is whether what was supplied
matched what was promised, and whether the complaint was handled. Lead with
the listing as it appeared at the time of purchase, the variant the buyer
selected, and any documented resolution offered — repair, replacement, return
or refund — together with the buyer's communications.
DELIVERY IS NOT CONFORMITY. The buyer does not dispute that the parcel
arrived; they dispute its contents. A delivery scan may appear as chronology
and must never be the principal rebuttal.`,

  refund_not_processed: `FOR THIS CLAIM (refund not processed) the question is whether a promised
credit actually reached the buyer. Lead with the refund record: amount,
currency, status, date, and its link to the disputed transaction. Where the
refund depended on a return, give the return and inspection chronology. A
refund policy on its own does not answer whether the refund happened.`,

  unauthorized: `FOR THIS CLAIM (unauthorized) the question is whether the account holder made
the purchase. Lead with the transaction and account identifiers available to
the merchant, fulfillment to the address on the transaction, confirmed
delivery or service access, prior order history for the same customer, and
post-purchase communications.
There is no AVS, CVV or 3-D Secure result in a wallet payment. Do not offer a
successful payment or an order record as proof of authorization — it is not.`,

  duplicate: `FOR THIS CLAIM (duplicate) the argument is narrow and must be one of two
things: the two payments are distinct purchases, or the duplicate was already
refunded. Lead with a side-by-side comparison — separate transaction
identifiers, order numbers, timestamps, line items and fulfilment records — or
with the refund record for the duplicate. Fulfilment evidence without that
comparison does not answer the claim.`,

  recurring_cancelled: `FOR THIS CLAIM (cancelled recurring billing) the argument is a timeline. Lead
with the buyer's acceptance of the recurring terms, the billing schedule, the
cancellation request timestamp and its effective date, and the charge
timestamp relative to that date, plus the service period the charge covers.
Terms alone cannot rebut a charge that fell after an effective cancellation.`,

  generic: `Address the buyer's stated reason with the evidence that answers it. Do not
pad the response with order and shipping records that speak to a question the
buyer did not raise.`,
};

const FORBIDDEN = `STRICTLY FORBIDDEN (these do not exist in a PayPal wallet dispute and must
never appear): AVS, CVV/CVC, 3-D Secure / 3DS, cardholder authentication,
Visa CE 3.0, Mastercard FPT / first-party misuse tools, issuer fraud scores,
card-network liability shift, "representment", or any card-network reason
code.`;

export function buildPaypalOverlay(input: {
  shopifyReason?: string | null;
}): string {
  const category = paypalCategoryForReason(input.shopifyReason);
  return [BASE, PER_CATEGORY[category], FORBIDDEN].join("\n\n");
}
