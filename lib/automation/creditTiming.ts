/**
 * Credit-already-issued detection — one timing comparison, shared.
 *
 * A refund issued BEFORE the cardholder filed is a fundamentally
 * different fact from one issued after. Visa's *Dispute Management
 * Guidelines* list "credit or reversal has already been processed for
 * the transaction" among the grounds that make a dispute **invalid**,
 * and direct the merchant to supply the credit documentation. It is not
 * a compelling-evidence category tied to a reason code — it attaches to
 * the transaction, which is why the defence built on it is
 * reason-code-agnostic.
 *
 * Three orderings exist and only the first is this one (plan §5a F2):
 *
 *   A  refund → chargeback later   allowed, representable   ← THIS
 *   B  chargeback open → refund    Shopify blocks it
 *   C  inquiry → refund            allowed; resolves the inquiry
 *
 * Both `detectFatalLoss` (to stop calling A unwinnable) and the
 * `refund_record` collector (to let the narrative argue it) need the
 * same answer, so it lives here rather than being re-derived.
 *
 * Everything unknown resolves to NOT triggered. A missing dispute date
 * or an unparseable refund timestamp must never be read as "the credit
 * came first" — that would put a claim we cannot support in front of an
 * issuer.
 */

import type { OrderDetailNode } from "@/lib/shopify/queries/orders";

export interface CreditAlreadyIssued {
  /** A refund is on record and precedes the dispute. */
  triggered: boolean;
  /** The latest qualifying (pre-dispute) refund timestamp. */
  refundedAt: string | null;
  /** Total refunded on the order, in the order's currency. */
  amount: number | null;
  /** `amount >= disputeAmount` — governs whether copy may say the
   *  transaction was credited IN FULL. Never assert full coverage
   *  without it. */
  coversDisputedAmount: boolean;
  /** `disputeAmount - amount` when positive — the portion the credit
   *  does NOT cover, so partial-coverage copy can name it honestly
   *  rather than overclaiming or staying silent. */
  residual: number | null;
}

const NONE: CreditAlreadyIssued = {
  triggered: false,
  refundedAt: null,
  amount: null,
  coversDisputedAmount: false,
  residual: null,
};

export function detectCreditAlreadyIssued(args: {
  order: OrderDetailNode | null;
  disputeAmount: number | null;
  /** `disputes.initiated_at`. */
  disputeInitiatedAt: string | null;
}): CreditAlreadyIssued {
  const { order, disputeAmount, disputeInitiatedAt } = args;
  if (!order) return NONE;

  const disputedAt = parseTime(disputeInitiatedAt);
  if (disputedAt == null) return NONE;

  // Latest refund that still precedes the dispute. "Latest" rather than
  // "first" so the reported date is the most recent credit the
  // cardholder actually received before filing.
  let latestPriorRefund: number | null = null;
  let latestPriorRefundIso: string | null = null;
  for (const refund of order.refunds ?? []) {
    const at = parseTime(refund?.createdAt);
    if (at == null || at >= disputedAt) continue;
    if (latestPriorRefund == null || at > latestPriorRefund) {
      latestPriorRefund = at;
      latestPriorRefundIso = refund.createdAt;
    }
  }
  if (latestPriorRefund == null) return NONE;

  const amount = parseMoney(order.totalRefundedSet?.shopMoney?.amount);
  const covers =
    amount != null && disputeAmount != null && disputeAmount > 0
      ? amount >= disputeAmount
      : false;
  const residual =
    amount != null && disputeAmount != null && disputeAmount > amount
      ? round2(disputeAmount - amount)
      : null;

  return {
    triggered: true,
    refundedAt: latestPriorRefundIso,
    amount,
    coversDisputedAmount: covers,
    residual,
  };
}

function parseTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function parseMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Currency-safe to 2dp — avoids 14.999999999999998 in merchant copy. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
