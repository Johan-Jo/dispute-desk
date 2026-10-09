/**
 * The order's return and refund situation, as Shopify records it.
 *
 * ── WHY ONE FUNCTION ──────────────────────────────────────────────────
 *
 * `Order.returnStatus` has been stamped on the pack's order section since
 * 2026-10-02, and for a week exactly one thing read it: the gate that hides
 * the "did the customer ask for a return?" question. Everything else behaved
 * as if no return existed. On whj8db-1q #21037 (2026-10-09) the store had
 * opened return #21037-R1 six weeks earlier; the merchant was offered "add
 * the customer's acknowledgement of receipt", shown "Return status: missing",
 * told to upload documents, and never shown the return.
 *
 * This is the one statement of that situation. Surfaces read it; none forms
 * its own (docs/plans/order-situation-drives-dispute.plan.md).
 *
 * ── WHAT IT IS NOT ────────────────────────────────────────────────────
 *
 * It is MERCHANT-SIDE. Nothing here is a bank-facing fact: it writes nothing
 * to `pack_json`, provides no evidence field and is not read by the letter,
 * the PDF or the chronology. Whether a return may be mentioned to a bank is a
 * per-family rule that lives with the letter.
 *
 * It does not say whether a refund covers the disputed amount. That is
 * `lib/automation/creditTiming.ts` (currency-aware); here a refund is only
 * "some" or "none".
 *
 * FAILS CLOSED ON UNKNOWNS, like `heldOrCancelledUnrefunded`: an absent
 * return status or refund amount is "unknown", never "none". A pack built
 * before the field existed knows nothing, and a note asserting "no refund has
 * been issued" from absent data tells a merchant something untrue about
 * their own money.
 */

/** Shopify's `OrderReturnStatus`, grouped by what it means for a dispute. */
export type ReturnSituation =
  /** `NO_RETURN`. */
  | "none"
  /** `RETURN_REQUESTED`: asked for, not yet approved. */
  | "requested"
  /** `IN_PROGRESS`: a return is open; the goods are not marked received. */
  | "in_progress"
  /** `RETURNED`, `INSPECTION_COMPLETE`: the store marked the return received. */
  | "returned"
  /** `RETURN_FAILED`. */
  | "failed"
  /** Not recorded, or a value this code does not know. */
  | "unknown";

export type RefundSituation = "none" | "some" | "unknown";

export interface OrderSituation {
  returns: ReturnSituation;
  refund: RefundSituation;
  /** When the return was created, from the order's own events. Optional by
   *  nature: Shopify writes event messages in the shop's admin language and
   *  the pack keeps the latest 20, so the status is the authority and the
   *  date is a detail that may be missing. */
  returnOpenedAt: string | null;
}

const RETURN_STATUS: Record<string, ReturnSituation> = {
  NO_RETURN: "none",
  RETURN_REQUESTED: "requested",
  IN_PROGRESS: "in_progress",
  RETURNED: "returned",
  INSPECTION_COMPLETE: "returned",
  RETURN_FAILED: "failed",
};

/** "Alice created return #21037-R1." — the event Shopify writes when a return
 *  is opened on an order. Narrow on purpose: "added tracking information to
 *  return" and "sent a return instructions email" are later steps. */
const RETURN_CREATED = /\bcreated return #/i;

export function resolveOrderSituation(input: {
  /** `Order.returnStatus` as persisted, or null when not recorded. */
  returnStatus?: string | null;
  /** The pack's decimal string ("0.0", "220.0"). Null = not recorded. */
  refundedAmount?: string | number | null;
  /** The order's events as the pack keeps them. */
  events?: ReadonlyArray<{ message?: unknown; createdAt?: unknown } | null | undefined> | null;
}): OrderSituation {
  const returns: ReturnSituation =
    typeof input.returnStatus === "string" ? RETURN_STATUS[input.returnStatus] ?? "unknown" : "unknown";

  let refund: RefundSituation = "unknown";
  if (input.refundedAmount != null && input.refundedAmount !== "") {
    const refunded = Number.parseFloat(String(input.refundedAmount));
    if (Number.isFinite(refunded)) refund = refunded > 0 ? "some" : "none";
  }

  // The earliest matching event: an order can carry more than one return.
  let returnOpenedAt: string | null = null;
  for (const e of input.events ?? []) {
    if (!e || typeof e.message !== "string" || typeof e.createdAt !== "string") continue;
    if (!RETURN_CREATED.test(e.message)) continue;
    if (!Number.isFinite(Date.parse(e.createdAt))) continue;
    if (returnOpenedAt === null || Date.parse(e.createdAt) < Date.parse(returnOpenedAt)) returnOpenedAt = e.createdAt;
  }

  return { returns, refund, returnOpenedAt };
}

type Section = { labelToken?: { key?: unknown } | null; type?: unknown; data?: unknown } | null | undefined;

/**
 * The situation read from a persisted pack's sections: the order section's
 * `returnStatus` and `totals.refunded`, and the activity log's events. Null
 * when the pack has no order section (queued, building or failed): nothing is
 * known, and nothing is said.
 */
export function orderSituationFromPackSections(sections: unknown): OrderSituation | null {
  if (!Array.isArray(sections)) return null;
  const list = sections as Section[];
  const order = list.find((s) => s?.labelToken?.key === "packs.section.order")?.data as
    | { returnStatus?: unknown; totals?: { refunded?: unknown } | null }
    | undefined;
  if (!order) return null;
  const log = list.find((s) => s?.type === "access_log")?.data as { timelineEvents?: unknown } | undefined;
  return resolveOrderSituation({
    returnStatus: typeof order.returnStatus === "string" ? order.returnStatus : null,
    refundedAmount: (order.totals?.refunded as string | number | null | undefined) ?? null,
    events: Array.isArray(log?.timelineEvents) ? (log.timelineEvents as Array<{ message?: unknown; createdAt?: unknown }>) : null,
  });
}

/** True when Shopify records a return on the order, at any stage. */
export function hasReturnOnRecord(s: OrderSituation | null | undefined): boolean {
  return !!s && (s.returns === "requested" || s.returns === "in_progress" || s.returns === "returned" || s.returns === "failed");
}

/** True when Shopify records a refund or a return on the order. */
export function hasReturnOrRefundOnRecord(s: OrderSituation | null | undefined): boolean {
  return !!s && (s.refund === "some" || hasReturnOnRecord(s));
}
