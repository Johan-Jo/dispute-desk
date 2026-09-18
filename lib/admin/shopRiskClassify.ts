/**
 * Pure classification helpers for the admin Risk Profile breakdowns.
 *
 * Kept in their own module (no Supabase / server imports) so they can
 * be unit-tested in isolation and reused by `shopRisk.ts` without
 * pulling the service client into the test graph.
 */

import {
  DISPUTE_REASON_FAMILIES,
  canonicalReasonCode,
} from "@/lib/rules/disputeReasons";

export type ReasonBucket =
  | "fraud"
  | "fulfillment"
  | "refund"
  | "quality"
  | "subscription"
  | "other";

/** Map a raw dispute-reason family (from DISPUTE_REASON_FAMILIES) to
 *  one of the six curated dashboard buckets. Everything not explicitly
 *  named (General / Billing / Technical / Compliance) falls to
 *  "other". */
const FAMILY_TO_BUCKET: Record<string, ReasonBucket> = {
  Fraud: "fraud",
  Authorization: "fraud",
  Fulfillment: "fulfillment",
  Refund: "refund",
  Quality: "quality",
  Subscription: "subscription",
};

export function classifyReasonFamily(
  reason: string | null | undefined,
): ReasonBucket {
  const code = canonicalReasonCode(reason);
  if (!code) return "other";
  const family = DISPUTE_REASON_FAMILIES[code];
  if (!family) return "other";
  return FAMILY_TO_BUCKET[family] ?? "other";
}

export type PaymentMethodBucket =
  | "card"
  | "apple_pay"
  | "google_pay"
  | "shop_pay"
  | "klarna"
  | "paypal"
  | "other"
  | "unknown";

/** Wallet values as Shopify actually emits them on
 *  `CardPaymentDetails.wallet`, lower-cased by pickPaymentMethod.
 *
 *  Shop Pay is the trap: Shopify returns `SHOPIFY_PAY`, so the column
 *  holds `shopify_pay`, while this classifier used to test only for
 *  `shop_pay` — every Shop Pay order silently fell through to "other".
 *  Both spellings map here so neither the stored value nor the product
 *  name can drift the bucket again. */
const WALLET_BUCKETS: Record<string, PaymentMethodBucket> = {
  apple_pay: "apple_pay",
  google_pay: "google_pay",
  shopify_pay: "shop_pay",
  shop_pay: "shop_pay",
};

/** Map a stored `shopify_orders.payment_method` value to a dashboard
 *  bucket. The column holds families like `card | apple_pay |
 *  google_pay | shopify_pay | klarna | paypal | <local method name>`.
 *
 *  Two distinct kinds of "not one of the named buckets" exist, and
 *  collapsing them is what made this dashboard unreadable:
 *    - "other"   — a real method we simply don't chart (ideal, affirm).
 *    - "unknown" — no method was ever derived for the order. That is a
 *                  coverage gap, not a payment method, and callers must
 *                  exclude it from the split rather than report it as
 *                  a method the merchant used. */
export function classifyPaymentMethod(
  method: string | null | undefined,
): PaymentMethodBucket {
  const m = method?.trim().toLowerCase();
  if (!m) return "unknown";
  if (m === "card") return "card";
  const wallet = WALLET_BUCKETS[m];
  if (wallet) return wallet;
  if (m.startsWith("klarna")) return "klarna";
  if (m.startsWith("paypal")) return "paypal";
  return "other";
}
