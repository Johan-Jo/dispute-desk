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
  | "other";

/** Map a stored `shopify_orders.payment_method` value to a dashboard
 *  bucket. The column holds families like `card | apple_pay |
 *  google_pay | shop_pay | klarna | <local method name>`. Wallet and
 *  Klarna are named explicitly; every other non-null local method
 *  (ideal, affirm, etc.) folds into "other". */
export function classifyPaymentMethod(
  method: string | null | undefined,
): PaymentMethodBucket {
  if (!method) return "other";
  const m = method.toLowerCase();
  if (m === "card") return "card";
  if (m === "apple_pay") return "apple_pay";
  if (m === "google_pay") return "google_pay";
  if (m === "shop_pay") return "shop_pay";
  if (m.startsWith("klarna")) return "klarna";
  return "other";
}
