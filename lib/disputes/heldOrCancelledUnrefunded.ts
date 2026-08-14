/**
 * "Nothing shipped, and the money is still captured" — the state the merchant
 * cannot see today.
 *
 * ── WHAT IT DESCRIBES ─────────────────────────────────────────────────
 *
 * An order that Shopify Flow flagged and either HELD or CANCELLED, on which no
 * refund was issued. The cardholder paid; no goods left the warehouse; the
 * merchant still has the money. From the cardholder's side that is
 * indistinguishable from being charged for nothing — which is why the
 * chargeback arrives, and why it cannot be won on delivery evidence.
 *
 * Measured on production 2026-08-14 across open, unsubmitted disputes:
 *
 *   11 cancelled   PAID, 0.0 refunded
 *    6 ON_HOLD     PAID, 0.0 refunded
 *
 * Uniform — every one PAID with nothing returned. The merchant surface showed
 * `delivery_proof: unavailable` and strength `weak`, with no explanation, so
 * it read as "we failed to ship" rather than "your fraud screening caught this
 * and the payment is still captured".
 *
 * ── WHY A PREDICATE AND NOT AN INLINE CHECK ───────────────────────────
 *
 * The condition has four parts and a `null` case that must NOT fire (a pack
 * built before `refunded` was persisted knows nothing about the money, and
 * guessing there would tell a merchant something false about their own
 * finances). That is worth naming, testing, and having one owner for.
 *
 * ── WHAT IT DOES NOT DO ───────────────────────────────────────────────
 *
 * It does not recommend refunding. Whether to refund is the merchant's call —
 * some held orders are genuine fraud they may prefer to contest. This states
 * the position; the copy states the mechanics.
 */

export type UnrefundedReason = "held" | "cancelled";

export interface HeldOrCancelledInput {
  /** `displayFulfillmentStatus` as persisted. */
  fulfillmentStatus?: string | null;
  /** ISO timestamp, or null when the order was never cancelled. */
  cancelledAt?: string | null;
  /** `financialStatus` — only a captured payment can be owed back. */
  financialStatus?: string | null;
  /** The pack's decimal string ("0.0", "220.0"). Null = not recorded. */
  refundedAmount?: string | null;
}

/**
 * Which of the two states this order is in, or null when neither applies.
 *
 * FAILS CLOSED ON UNKNOWNS. A missing `refundedAmount` returns null rather
 * than assuming zero: the banner asserts "no refund has been issued", and
 * asserting that from absent data is how a merchant gets told something untrue
 * about their own money. Same for an unparseable amount.
 */
export function heldOrCancelledUnrefunded(
  order: HeldOrCancelledInput | null | undefined,
): UnrefundedReason | null {
  if (!order) return null;

  // Only a CAPTURED payment can be sitting unreturned. An authorised-only or
  // already-refunded order has no money in the wrong place.
  if ((order.financialStatus ?? "").toUpperCase() !== "PAID") return null;

  // Absent is unknown, not zero.
  if (order.refundedAmount == null || order.refundedAmount === "") return null;
  const refunded = Number(order.refundedAmount);
  if (!Number.isFinite(refunded)) return null;
  if (refunded > 0) return null;

  // Cancelled is the stronger statement — a deliberate, completed decision —
  // so it wins when an order is somehow both.
  if (order.cancelledAt) return "cancelled";
  if ((order.fulfillmentStatus ?? "").toUpperCase() === "ON_HOLD") return "held";
  return null;
}
