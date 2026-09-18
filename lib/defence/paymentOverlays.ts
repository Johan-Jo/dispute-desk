/**
 * Payment-method overlays for the defence narrative.
 *
 * BNPL methods (Klarna, Affirm) and other local payment methods settle
 * through Shopify Payments but are NOT card transactions. The reason
 * modules were written for card disputes, so for a non-card dispute we
 * layer a payment overlay on top that (a) reframes to the actual method
 * and (b) forbids card-network artifacts that don't exist for BNPL.
 *
 * The overlay is a cross-cutting system-prompt block (see
 * narrativeWriter.ts). The hard-banned phrases are enforced by
 * validateNarrative's `extraHardPhrases` so a stray "3-D Secure" or
 * "AVS match" is a hard rejection, not a soft hope.
 *
 * We do NOT assert Klarna/Affirm-specific adjudication rules (their exact
 * evidence spec for the Shopify Payments path isn't publicly documented).
 * The framing is neutral and evidence-led: delivery proof for
 * not-received, refund proof for refund-not-processed.
 */

import type {
  KlarnaSubProduct,
  PaymentMethodFamily,
} from "@/lib/disputes/paymentContext";
import { isNonCardPaymentFamily } from "@/lib/disputes/paymentContext";
import { buildKlarnaOverlay } from "./klarnaOverlay";
import { buildPaypalOverlay } from "./paypalOverlay";

/**
 * Card-network vocabulary that must never appear in a BNPL/local
 * narrative. These are card-issuer/card-scheme constructs with no meaning
 * for a Klarna/Affirm dispute; citing them is both irrelevant and
 * credibility-eroding. Enforced as hard rejections in validateNarrative.
 */
export const BNPL_PROHIBITED_CARD_PHRASES: readonly RegExp[] = [
  /\bAVS\b/i,
  /address verification (system|service)/i,
  /\bCVV\b/i,
  /\bCVC\b/i,
  /card verification (value|code)/i,
  /3[\s-]?D[\s-]?secure/i,
  /\b3DS\b/i,
  /cardholder authentication/i,
  /\bCE ?3\.0\b/i,
  /compelling evidence 3\.0/i,
  /\bFPT\b/i,
  /first[\s-]?party (fraud|misuse) (tool|program)/i,
  /issuer (fraud|risk) (score|signal)/i,
  /card[\s-]?network liability shift/i,
  /\brepresentment\b/i,
  /chargeback reason code/i,
];

/**
 * Neutral BNPL/local overlay. Emphasizes the evidence that actually
 * matters for the two dominant BNPL dispute reasons (not-received →
 * delivery proof; refund-not-processed → refund record) without asserting
 * unverified provider-specific rules or naming a specific adjudicator.
 */
const BNPL_OVERLAY = `PAYMENT METHOD OVERLAY — Buy-Now-Pay-Later / local payment method.

This dispute was NOT paid by card. It was paid via a Buy-Now-Pay-Later or
local payment method (e.g. Klarna, Affirm) that settles through Shopify
Payments. Tailor the response accordingly:

- Frame this as a payment dispute for the stated reason. Do NOT frame it as
  a card chargeback and do NOT reference card networks or card issuers.
- Lead with the evidence relevant to the reason:
  * Not received → fulfillment timeline, carrier, tracking number, delivery
    timestamp, proof of delivery, recipient/signature if available,
    shipping-address match, and customer communication.
  * Refund not processed → refund status, refund timestamp and amount,
    refund/return references, return status/tracking, the applicable
    refund/cancellation policy, and whether the customer was entitled to a
    refund, plus customer communication.
- Use neutral wording. Do NOT claim to be addressing a specific provider's
  internal adjudication rules; present the facts and let the evidence stand.

STRICTLY FORBIDDEN (these do not apply to a non-card payment and must never
appear): AVS, CVV/CVC, 3-D Secure / 3DS, cardholder authentication,
Visa CE 3.0, Mastercard FPT / first-party misuse tools, issuer fraud
scores, card-network liability shift, "representment", or any card-network
reason code.`;

/**
 * Overlay + hard-banned phrases for a payment-method family. Returns null
 * overlay + empty phrases for card (no overlay needed — the reason module
 * already targets card).
 *
 * For **Klarna**, when the dispute `reason` (and optional sub-product) is
 * supplied, we return a Klarna-specific, category-aware overlay
 * (`buildKlarnaOverlay`) that injects Klarna's real evidence expectations
 * per category (Goods-Not-Received → POD/MPP, Faulty → resolution offered,
 * etc.). Without a reason, and for Affirm / other BNPL / local methods, we
 * fall back to the neutral generic BNPL overlay. The hard-banned card
 * phrases are identical either way.
 */
export function paymentOverlayFor(
  family: PaymentMethodFamily | string | null | undefined,
  klarnaContext?: {
    shopifyReason?: string | null;
    subProduct?: KlarnaSubProduct | null;
  },
): {
  overlay: string | null;
  prohibitedPhrases: readonly RegExp[];
} {
  if (!isNonCardPaymentFamily(family)) {
    return { overlay: null, prohibitedPhrases: [] };
  }
  // PayPal is a wallet, not BNPL. Routing it to the generic BNPL overlay told
  // the model the buyer had used an instalment product they never used. On
  // prod that was the framing on essentially one merchant's whole dispute
  // book — 518 of 522 disputes carry no network reason code, and a live
  // Admin-API probe found 98.7% of a 462-order sample paid by PayPal wallet.
  // No context object is required: with no reason the overlay returns its
  // generic category, still correctly framed as a wallet dispute.
  if (family === "paypal") {
    return {
      overlay: buildPaypalOverlay({
        shopifyReason: klarnaContext?.shopifyReason ?? null,
      }),
      prohibitedPhrases: BNPL_PROHIBITED_CARD_PHRASES,
    };
  }
  if (family === "klarna" && klarnaContext) {
    return {
      overlay: buildKlarnaOverlay({
        shopifyReason: klarnaContext.shopifyReason ?? null,
        subProduct: klarnaContext.subProduct ?? null,
      }),
      prohibitedPhrases: BNPL_PROHIBITED_CARD_PHRASES,
    };
  }
  return { overlay: BNPL_OVERLAY, prohibitedPhrases: BNPL_PROHIBITED_CARD_PHRASES };
}
