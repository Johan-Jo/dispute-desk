/**
 * Payment-method context for a dispute's order.
 *
 * Models the payment method as a first-class dimension PARALLEL to card
 * network — deliberately NOT folded into `CardNetwork`. A dispute has
 * both: how it was paid (`family`, e.g. Klarna/Affirm/card) and, when
 * card, which network (`cardNetwork`). BNPL/local methods (Klarna,
 * Affirm) settle through Shopify Payments and surface as
 * `LocalPaymentMethodsPaymentDetails` with a `paymentMethodName`; they
 * carry no card network.
 *
 * Why this matters: the dispute pipeline was built for Visa/Mastercard
 * card fraud (CE 3.0, FPT, AVS/CVV/3DS). Those paths must stay
 * card-scheme-specific and NOT fire for BNPL. This classifier is the
 * single source of truth for "is this a card / Klarna / Affirm / …
 * dispute" so evidence + narrative can branch intentionally instead of
 * silently degrading.
 *
 * Card detection reuses `deriveCardNetwork` (unchanged behavior). BNPL
 * detection is by known-set + prefix on `paymentMethodName`. We have
 * observed Klarna's values (`klarna`, `klarna_pay_later`,
 * `klarna_slice_it`); we have NOT observed Affirm's exact string, so
 * Affirm is matched by `affirm` prefix and ANY unrecognized local method
 * falls to `local_payment_method` (still non-card-safe). The raw
 * `paymentMethodName` is always preserved in `raw` and logged by callers
 * so the first real Affirm order lets us confirm/tighten.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";
import type { CardNetwork } from "./reasonCodeCatalog";
import {
  deriveCardNetwork,
  pickPrimaryCardTransaction,
} from "./enrichNetworkReasonCode";

/**
 * Payment-method family. `bnpl` is a coarse grouping used only when a
 * local method is clearly BNPL but not a recognized brand; recognized
 * brands get their own value (`klarna`, `affirm`) so labels/analytics are
 * precise. `local_payment_method` = a LocalPaymentMethodsPaymentDetails
 * we don't recognize (iDEAL, Bancontact, or an unconfirmed Affirm
 * string). All of klarna|affirm|bnpl|local_payment_method are
 * "non-card" and route through the BNPL/local-safe path.
 */
export type PaymentMethodFamily =
  | "card"
  | "klarna"
  | "affirm"
  | "bnpl"
  | "wallet"
  | "local_payment_method"
  | "manual"
  | "gift_card"
  | "other"
  | "unknown";

export interface PaymentContext {
  family: PaymentMethodFamily;
  /** Raw signal we classified from: the lowercased paymentMethodName for
   *  local methods, the wallet for card+wallet, else null. Preserved so
   *  callers can log/confirm unrecognized values (esp. Affirm). */
  raw: string | null;
  /** Human-facing label, e.g. "Klarna — Pay Later", "Card (Apple Pay)". */
  label: string | null;
  /** Card network when family === "card", else null. */
  cardNetwork: CardNetwork | null;
}

/** Families that are NOT card — card-scheme logic (CE 3.0, FPT, AVS/CVV/
 *  3DS) must be treated as not-applicable for these, and the BNPL/local
 *  narrative overlay applies. */
const NON_CARD_FAMILIES: ReadonlySet<PaymentMethodFamily> = new Set([
  "klarna",
  "affirm",
  "bnpl",
  "local_payment_method",
]);

/** True for Klarna/Affirm/other BNPL & local methods — the set that gets
 *  the shared non-card evidence + narrative treatment. Accepts a plain
 *  string (e.g. a family read back from persisted pack_json) as well as
 *  the branded union. */
export function isNonCardPaymentFamily(
  family: PaymentMethodFamily | string | null | undefined,
): boolean {
  return family != null && NON_CARD_FAMILIES.has(family as PaymentMethodFamily);
}

/** Wallet raw value → display suffix. */
function walletLabel(wallet: string): string {
  const map: Record<string, string> = {
    apple_pay: "Apple Pay",
    google_pay: "Google Pay",
    shop_pay: "Shop Pay",
  };
  return map[wallet] ?? wallet;
}

/** Klarna sub-product raw value → display suffix. */
function klarnaLabel(raw: string): string {
  const map: Record<string, string> = {
    klarna: "Klarna",
    klarna_pay_later: "Klarna — Pay Later",
    klarna_pay_now: "Klarna — Pay Now",
    klarna_slice_it: "Klarna — Slice It",
  };
  return map[raw] ?? "Klarna";
}

/**
 * Classify the payment-method context of a dispute's order. Pure — no
 * DB/Shopify calls. Reads the primary transaction's paymentDetails.
 */
export function derivePaymentContext(
  order: OrderDetailNode | null,
): PaymentContext {
  const empty: PaymentContext = {
    family: "unknown",
    raw: null,
    label: null,
    cardNetwork: null,
  };
  if (!order) return empty;

  const tx = pickPrimaryCardTransaction(order.transactions);
  if (!tx) return empty;

  const pd = tx.paymentDetails as
    | {
        __typename?: string;
        wallet?: string | null;
        paymentMethodName?: string | null;
      }
    | null
    | undefined;

  // gift_card / manual / cash orders legitimately carry no typed
  // paymentDetails — classify them from the transaction gateway. This
  // runs both when paymentDetails is absent and when it's an
  // unrecognized union member (below).
  const gatewayFallback = (): PaymentContext => {
    const gateway = tx.gateway?.trim().toLowerCase() || null;
    if (gateway === "gift_card") {
      return { family: "gift_card", raw: gateway, label: "Gift card", cardNetwork: null };
    }
    if (gateway === "manual" || gateway === "cash") {
      return { family: "manual", raw: gateway, label: "Manual / offline", cardNetwork: null };
    }
    return gateway
      ? { family: "other", raw: gateway, label: gateway, cardNetwork: null }
      : empty;
  };

  if (!pd) return gatewayFallback();

  // ── Card (with optional wallet) ──────────────────────────────────
  if (pd.__typename === "CardPaymentDetails") {
    const cardNetwork = deriveCardNetwork(order);
    const wallet = pd.wallet?.trim().toLowerCase() || null;
    if (wallet) {
      // A wallet is still a card underneath; keep family "card" so card
      // logic (AVS/CVV/3DS/CE3.0/FPT) still applies, but label the wallet.
      return {
        family: "card",
        raw: wallet,
        label: `Card (${walletLabel(wallet)})`,
        cardNetwork,
      };
    }
    return {
      family: "card",
      raw: null,
      label: cardNetwork ? `Card (${cardNetwork})` : "Card",
      cardNetwork,
    };
  }

  // ── Local / BNPL methods ─────────────────────────────────────────
  if (pd.__typename === "LocalPaymentMethodsPaymentDetails") {
    const name = pd.paymentMethodName?.trim().toLowerCase() || null;
    if (!name) {
      return {
        family: "local_payment_method",
        raw: null,
        label: "Local payment method",
        cardNetwork: null,
      };
    }
    if (name.startsWith("klarna")) {
      return {
        family: "klarna",
        raw: name,
        label: klarnaLabel(name),
        cardNetwork: null,
      };
    }
    if (name.startsWith("affirm")) {
      // Affirm's exact paymentMethodName is unverified — prefix-match and
      // preserve raw so the first real order confirms it.
      return {
        family: "affirm",
        raw: name,
        label: "Affirm",
        cardNetwork: null,
      };
    }
    // Recognized-BNPL long tail could go here later. Unknown local method
    // stays generic (iDEAL, Bancontact, unconfirmed Affirm variant) but
    // still gets non-card-safe handling.
    return {
      family: "local_payment_method",
      raw: name,
      label: name,
      cardNetwork: null,
    };
  }

  // ── Unrecognized paymentDetails union member ─────────────────────
  // (e.g. gift card / manual surfaced with a typed member we don't model)
  // — fall back to the transaction gateway.
  return gatewayFallback();
}
