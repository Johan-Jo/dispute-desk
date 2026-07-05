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

/** Klarna sub-product. Shopify's GraphQL `paymentMethodName` collapses
 *  every Klarna order to the bare string "klarna", so the real product is
 *  NOT available there. It IS available in the transaction `receiptJson`
 *  (Shopify Payments = Stripe under the hood) at
 *  `payment_method_details.klarna.payment_method_category`. Empirically
 *  (cay-collective, 500-order probe 2026-07-04) the values seen are
 *  `pay_later` (77.7%) and `pay_now` (22.3%). `pay_over_time` / `pay_in_*`
 *  are documented Stripe values kept for forward-compat. Sub-product
 *  matters because pay_later (consumer credit) correlates with a higher
 *  chargeback rate than pay_now (immediate debit). `null` when not a
 *  Klarna order or the receipt didn't carry the category. */
export type KlarnaSubProduct =
  | "pay_now"
  | "pay_later"
  | "pay_over_time"
  | "pay_in_installments"
  | "pay_with_financing"
  | "other";

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
  /** Klarna sub-product from receiptJson (pay_now / pay_later / …), or
   *  null. Only set when family === "klarna". Optional so existing
   *  PaymentContext literals (tests, fixtures) remain valid; absence is
   *  equivalent to null. */
  klarnaSubProduct?: KlarnaSubProduct | null;
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

/** Map a raw Stripe/Shopify `payment_method_category` string to our
 *  KlarnaSubProduct enum. Unknown non-empty values → "other" (preserved in
 *  logs upstream); empty/absent → null. */
function normalizeKlarnaSubProduct(
  raw: string | null | undefined,
): KlarnaSubProduct | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === "pay_now" || v === "paynow") return "pay_now";
  if (v === "pay_later" || v === "paylater") return "pay_later";
  if (v === "pay_over_time" || v === "payovertime") return "pay_over_time";
  if (v === "pay_in_installments" || v === "installments") return "pay_in_installments";
  if (v === "pay_with_financing" || v === "financing") return "pay_with_financing";
  return "other";
}

/** Extract the Klarna sub-product from a transaction's receiptJson.
 *  Shopify's GraphQL `paymentMethodName` collapses to bare "klarna"; the
 *  real category lives in the Stripe-shaped receipt at
 *  `payment_method_details.klarna.payment_method_category` (modern shape)
 *  or under `charges.data[0]` / `latest_charge` (legacy). receiptJson is
 *  NOT a stable contract (per CLAUDE.md) — parse + walk defensively. */
export function extractKlarnaSubProduct(
  receiptJson: string | Record<string, unknown> | null | undefined,
): KlarnaSubProduct | null {
  if (receiptJson == null) return null;
  let receipt: unknown = receiptJson;
  if (typeof receipt === "string") {
    try {
      receipt = JSON.parse(receipt);
    } catch {
      return null;
    }
  }
  if (!receipt || typeof receipt !== "object") return null;

  const getPath = (obj: unknown, path: (string | number)[]): unknown => {
    let cur: unknown = obj;
    for (const k of path) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string | number, unknown>)[k];
    }
    return cur;
  };

  const category =
    getPath(receipt, ["payment_method_details", "klarna", "payment_method_category"]) ??
    getPath(receipt, ["latest_charge", "payment_method_details", "klarna", "payment_method_category"]) ??
    getPath(receipt, ["charges", "data", 0, "payment_method_details", "klarna", "payment_method_category"]);

  return normalizeKlarnaSubProduct(
    typeof category === "string" ? category : null,
  );
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
    klarnaSubProduct: null,
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
      return { family: "gift_card", raw: gateway, label: "Gift card", cardNetwork: null, klarnaSubProduct: null };
    }
    if (gateway === "manual" || gateway === "cash") {
      return { family: "manual", raw: gateway, label: "Manual / offline", cardNetwork: null, klarnaSubProduct: null };
    }
    return gateway
      ? { family: "other", raw: gateway, label: gateway, cardNetwork: null, klarnaSubProduct: null }
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
        klarnaSubProduct: null,
      };
    }
    return {
      family: "card",
      raw: null,
      label: cardNetwork ? `Card (${cardNetwork})` : "Card",
      cardNetwork,
      klarnaSubProduct: null,
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
        klarnaSubProduct: null,
      };
    }
    if (name.startsWith("klarna")) {
      // Shopify's paymentMethodName is just "klarna"; recover the real
      // sub-product (pay_now / pay_later / …) from the receiptJson. Refine
      // the label when we know it (e.g. "Klarna — Pay Later").
      const subProduct = extractKlarnaSubProduct(tx.receiptJson);
      const subLabel: Record<string, string> = {
        pay_now: "Klarna — Pay Now",
        pay_later: "Klarna — Pay Later",
        pay_over_time: "Klarna — Pay Over Time",
        pay_in_installments: "Klarna — Installments",
        pay_with_financing: "Klarna — Financing",
      };
      return {
        family: "klarna",
        raw: name,
        label:
          (subProduct && subLabel[subProduct]) ?? klarnaLabel(name),
        cardNetwork: null,
        klarnaSubProduct: subProduct,
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
        klarnaSubProduct: null,
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
      klarnaSubProduct: null,
    };
  }

  // ── Unrecognized paymentDetails union member ─────────────────────
  // (e.g. gift card / manual surfaced with a typed member we don't model)
  // — fall back to the transaction gateway.
  return gatewayFallback();
}
