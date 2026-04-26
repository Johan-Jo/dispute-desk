/**
 * Fatal-loss gate (PRD v1.1 §3 step 2 / §5).
 *
 * Detects cases where evidence-strength scoring is misleading because
 * the case is structurally unwinnable. When triggered:
 *   - case strength is capped at "weak"
 *   - the hero copy explains the structural reason
 *   - auto-mode submission is blocked (review-mode still parks)
 *
 * LOCKED scope for v1 — only two triggers:
 *   1. refundIssued      — order.totalRefundedSet.amount >= dispute.amount
 *   2. inrNoFulfillment  — reason === PRODUCT_NOT_RECEIVED AND order has
 *                          no successful fulfillment
 *
 * Out of scope here (deferred to a future P4.1+):
 *   - "Valid cancellation before billing" (no source today)
 *   - "Confirmed fraud accepted by merchant" (no UI today)
 *   - "Evidence contradiction" (needs a contradiction model)
 *
 * The gate only ever makes auto-mode stricter. False positives manifest
 * as "missed auto-submit", never as "bad submission". Review-mode is
 * unaffected.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export type FatalLossReason =
  | "refund_issued"        // a refund covering the disputed amount has already been issued
  | "inr_no_fulfillment";  // INR dispute on an order that was never fulfilled

export interface FatalLossSummary {
  triggered: boolean;
  reason: FatalLossReason | null;
  /** Merchant-facing one-liner explaining why the case is unwinnable.
   *  Surfaced as `caseStrength.strengthReason` when triggered. */
  message: string | null;
}

const NOT_TRIGGERED: FatalLossSummary = { triggered: false, reason: null, message: null };

/** Shopify dispute reason codes that indicate Item Not Received. */
const INR_REASON_CODES = new Set<string>([
  "PRODUCT_NOT_RECEIVED",
  // Older / legacy code used by some integrations:
  "ITEM_NOT_RECEIVED",
]);

/** Per-reason merchant-facing copy. Bank-rebuttal-safe — never surfaces in
 *  the submitted text path; only renders in the merchant UI's hero. */
const MESSAGES: Record<FatalLossReason, string> = {
  refund_issued:
    "A refund covering this charge has already been issued — disputing the chargeback after a refund is unlikely to succeed.",
  inr_no_fulfillment:
    "This dispute references an order that was never fulfilled — there is no shipping evidence available to defend an item-not-received claim.",
};

/**
 * Detect fatal-loss conditions from the order + dispute context.
 * Pure — no I/O, deterministic.
 *
 * @param order       Order detail from `ORDER_DETAIL_QUERY`. Null when
 *                    the dispute has no linked order or the fetch failed
 *                    (in which case the gate cannot fire — we don't know
 *                    enough to be sure the case is unwinnable).
 * @param disputeReason  Shopify dispute reason code (e.g. PRODUCT_NOT_RECEIVED).
 * @param disputeAmount  Disputed amount in the order's currency. May be
 *                    null on legacy disputes; the refund check skips when
 *                    null (we'd otherwise risk false positives on partial
 *                    refunds).
 */
export function detectFatalLoss(
  order: OrderDetailNode | null,
  disputeReason: string | null,
  disputeAmount: number | null,
): FatalLossSummary {
  if (!order) return NOT_TRIGGERED;

  // Trigger 1: refund covering the disputed amount has been issued.
  if (disputeAmount != null && disputeAmount > 0) {
    const refunded = parseMoney(order.totalRefundedSet?.shopMoney?.amount);
    if (refunded != null && refunded >= disputeAmount) {
      return {
        triggered: true,
        reason: "refund_issued",
        message: MESSAGES.refund_issued,
      };
    }
  }

  // Trigger 2: INR dispute on an unfulfilled order.
  const isInr =
    typeof disputeReason === "string" &&
    INR_REASON_CODES.has(disputeReason.toUpperCase());
  if (isInr) {
    const status = order.displayFulfillmentStatus ?? null;
    const fulfillmentCount = order.fulfillments?.length ?? 0;
    if (status === "UNFULFILLED" && fulfillmentCount === 0) {
      return {
        triggered: true,
        reason: "inr_no_fulfillment",
        message: MESSAGES.inr_no_fulfillment,
      };
    }
  }

  return NOT_TRIGGERED;
}

function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
