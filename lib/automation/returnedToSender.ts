/**
 * Returned-to-sender gate.
 *
 * ── The case that created it ──────────────────────────────────────────
 *
 * cay-collective #13195. Order shipped 2026-06-18 via DHL Freight, failed
 * delivery, and was **returned to sender on 2026-07-06**. Nobody at the
 * merchant noticed — the order had been archived the minute it was
 * fulfilled. No refund was issued and no customer contact followed. Six
 * weeks later the cardholder opened a Klarna dispute: "refund not
 * processed".
 *
 * The goods were with the merchant. So was the money. DisputeDesk scored
 * the case MODERATE and drafted a response arguing that no refund was
 * owed because the customer never returned the goods.
 *
 * ── Why this is its own gate and not a fatal-loss trigger ─────────────
 *
 * Fatal-loss means "there is no factual basis to defend the charge". That
 * is too strong here, and saying it would be its own kind of dishonesty.
 * Klarna's merchant documentation is explicit that a parcel refused or
 * left uncollected and sent back "is not a valid use of the right of
 * withdrawal (in the EU) nor is it considered a valid return", and it
 * asks merchants to put exactly that in their response. There IS an
 * argument. It is narrow, it depends on WHY the parcel came back, and
 * only the merchant knows that — which is what the parcel-outcome
 * control asks (`app/api/packs/[packId]/parcel-outcome`).
 *
 * What is NOT available is an automated filing. Absent a proof of
 * delivery — and a returned parcel can never have one — Klarna decides
 * for the customer. So the gate does what the evidence supports and no
 * more:
 *
 *   - caps `overall` at "weak"        (the score stops overstating)
 *   - blocks auto-submit and the deadline filing (a human decides)
 *   - explains itself in merchant copy (never bank-facing)
 *
 * ── Ordering ──────────────────────────────────────────────────────────
 *
 * Coverage beats everything (Shopify pays; nothing else matters).
 * Fatal-loss beats this (a refund already issued is a bigger fact than a
 * parcel in the stockroom). This gate beats ordinary scoring.
 *
 * ── Why "unrefunded" is a conjunct ────────────────────────────────────
 *
 * A returned parcel the merchant already refunded is not a problem — it
 * is a resolved order, and `detectFatalLoss` / `detectCreditAlreadyIssued`
 * already reason about the refund on their own terms. This gate exists
 * for the gap between the goods coming back and the money going back.
 * Like every gate here it only ever makes automation STRICTER: a false
 * positive costs a missed auto-submit, never a bad submission.
 */

import type { I18nToken } from "@/lib/i18n/token";
import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export type ReturnedToSenderReason =
  /** The carrier brought it back and no refund covers the dispute. */
  | "returned_unrefunded";

export interface ReturnedToSenderSummary {
  triggered: boolean;
  reason: ReturnedToSenderReason | null;
  /** Carrier's terminal return timestamp, when one is known. Merchant
   *  copy names the date — "came back on 6 Jul" is actionable in a way
   *  that "came back" is not. */
  returnedAt: string | null;
  /** Merchant-facing token. Surfaced as `strengthReasonI18n`.
   *  NEVER bank-facing — see the module header. */
  messageToken: I18nToken | null;
}

const NOT_TRIGGERED: ReturnedToSenderSummary = {
  triggered: false,
  reason: null,
  returnedAt: null,
  messageToken: null,
};

export interface DetectReturnedToSenderInput {
  /** Did any shipment on this order reconcile to the carrier's
   *  return-to-sender terminal state? Derived by the caller from the
   *  assembled pack sections — see `hasReturnedToSenderShipment` in
   *  `lib/packs/contradictionGate.ts`, which is the one definition of
   *  what "the parcel came back" means. */
  returnedToSender: boolean;
  /** Terminal return timestamp, ISO, when the carrier reported one. */
  returnedAt: string | null;
  order: OrderDetailNode | null;
  disputeAmount: number | null;
}

export function detectReturnedToSender(
  input: DetectReturnedToSenderInput,
): ReturnedToSenderSummary {
  if (!input.returnedToSender) return NOT_TRIGGERED;

  // A refund covering the dispute takes this out of scope — the money
  // followed the goods, and the refund gates own that story.
  const refunded = parseMoney(input.order?.totalRefundedSet?.shopMoney?.amount);
  if (
    input.disputeAmount != null &&
    input.disputeAmount > 0 &&
    refunded != null &&
    refunded >= input.disputeAmount
  ) {
    return NOT_TRIGGERED;
  }

  return {
    triggered: true,
    reason: "returned_unrefunded",
    returnedAt: input.returnedAt,
    messageToken: {
      key: "disputes.strengthReason.returnedToSender.returned_unrefunded",
    },
  };
}

function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}
