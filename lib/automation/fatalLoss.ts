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
 *   1. refundIssued      — order.totalRefundedSet.amount >= dispute.amount,
 *                          and the credit did NOT precede the dispute
 *                          (see below)
 *   2. inrNoFulfillment  — reason === PRODUCT_NOT_RECEIVED AND order has
 *                          no successful fulfillment
 *
 * ── Refund timing (corrected 2026-08-01) ──
 * A refund is only a losing position when it lands ON or AFTER the
 * dispute. A credit issued BEFORE the cardholder filed is the opposite:
 * it is among the strongest representments available, because the
 * cardholder already has the money and the issuer should never have
 * processed a chargeback on an already-credited transaction. Both
 * networks have rules aimed at preventing exactly that double credit.
 *
 * The original gate ignored timing and capped every refunded case at
 * "weak" / "hard to win" with auto-submit blocked. On blume-box dispute
 * 162042cd the merchant refunded $220 on 2026-07-13 and the chargeback
 * arrived 2026-07-31 — eighteen days later — and DisputeDesk told them
 * the case was structurally unwinnable and stood down. The pack already
 * carried the winning fact (`refund_record`, `refundStatus: processed`,
 * `refundedAt`, bankEligible, includeInBankNarrative); only this gate
 * was wrong.
 *
 * Timing is decided from `order.refunds[].createdAt`. When the dispute
 * date is unknown, or no refund carries a usable timestamp, we keep the
 * old conservative behaviour and treat it as fatal — the gate only ever
 * makes auto-mode stricter, so an unresolved timestamp must not become
 * an auto-submission.
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

import type { I18nToken } from "@/lib/i18n/token";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export type FatalLossReason =
  | "refund_issued"        // a refund covering the disputed amount has already been issued
  | "inr_no_fulfillment";  // INR dispute on an order that was never fulfilled

export interface FatalLossSummary {
  triggered: boolean;
  reason: FatalLossReason | null;
  /** Merchant-facing token explaining why the case is unwinnable.
   *  Surfaced as `caseStrength.strengthReasonI18n` when triggered.
   *  Bank-rebuttal-safe — never surfaces in submitted text. */
  messageToken: I18nToken | null;
}

const NOT_TRIGGERED: FatalLossSummary = { triggered: false, reason: null, messageToken: null };

/** Shopify dispute reason codes that indicate Item Not Received. */
const INR_REASON_CODES = new Set<string>([
  "PRODUCT_NOT_RECEIVED",
  // Older / legacy code used by some integrations:
  "ITEM_NOT_RECEIVED",
]);

/** Per-reason merchant-facing token. The translator owns the locale
 *  copy — see `messages/*.json` `disputes.strengthReason.fatalLoss.*`. */
function messageTokenFor(reason: FatalLossReason): I18nToken {
  return { key: `disputes.strengthReason.fatalLoss.${reason}` };
}

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
 * @param disputeInitiatedAt  ISO timestamp the dispute was opened
 *                    (`disputes.initiated_at`). Null on legacy rows — the
 *                    refund trigger then stays conservative and fires.
 */
export function detectFatalLoss(
  order: OrderDetailNode | null,
  disputeReason: string | null,
  disputeAmount: number | null,
  disputeInitiatedAt: string | null = null,
): FatalLossSummary {
  if (!order) return NOT_TRIGGERED;

  // Trigger 1: refund covering the disputed amount has been issued —
  // but ONLY when the credit did not precede the dispute. See the
  // "Refund timing" note in the module header.
  if (disputeAmount != null && disputeAmount > 0) {
    const refunded = parseMoney(order.totalRefundedSet?.shopMoney?.amount);
    if (refunded != null && refunded >= disputeAmount) {
      if (!creditPrecededDispute(order, disputeInitiatedAt)) {
        return {
          triggered: true,
          reason: "refund_issued",
          messageToken: messageTokenFor("refund_issued"),
        };
      }
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
        messageToken: messageTokenFor("inr_no_fulfillment"),
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

/**
 * Did the merchant credit the cardholder BEFORE the dispute was filed?
 *
 * True only when we can positively establish it: a parseable dispute
 * date AND at least one refund with a parseable `createdAt` strictly
 * earlier than it. Every unknown resolves to false, which keeps the
 * fatal-loss trigger firing — the gate is allowed to be over-strict
 * (a missed auto-submit), never over-permissive (a bad submission).
 *
 * "At least one" rather than "all": a pre-dispute credit covering the
 * amount is the representable fact. A later top-up refund does not
 * un-issue it.
 */
function creditPrecededDispute(
  order: OrderDetailNode,
  disputeInitiatedAt: string | null,
): boolean {
  const disputedAt = parseTime(disputeInitiatedAt);
  if (disputedAt == null) return false;
  for (const refund of order.refunds ?? []) {
    const at = parseTime(refund?.createdAt);
    if (at != null && at < disputedAt) return true;
  }
  return false;
}

function parseTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}
