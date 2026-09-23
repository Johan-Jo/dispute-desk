/**
 * Internal narrative constraints — knowledge the VALIDATOR needs and the
 * GENERATOR must never see.
 *
 * The bank-facing pack deliberately excludes a customer's reimbursement
 * request: `gorgiasCommSource` admits only approved/manual messages and hard-
 * blocks `refund_history` / `cancellation_history` (the merchant's-counsel
 * rule — never hand the issuer the cardholder's argument). That exclusion is
 * correct, and it leaves the validator blind: blume-box #360980's letter told
 * the issuer "no … refund request … has been initiated" while the customer's
 * stored message (`review_status = proposed`, classified `contradiction`)
 * asked to be reimbursed.
 *
 * So the constraint is derived BESIDE the pack, from stored messages, and
 * carries ids and one date — never text. It reaches the validators only
 * (docs/plans/non-receipt-delivery-evidence.plan.md §4.1(c)). The generator,
 * the projection, the PDF composer and `facts_json` never receive it.
 */

import type { NarrativeSectionKey } from "./types";

export interface InternalNarrativeConstraints {
  /** A customer asked for a refund, reimbursement or compensation in a stored
   *  message on an order-matched ticket. Ids + the first request date only. */
  refundOrCompensationRequested: {
    messageIds: string[];
    firstSentAt: string | null;
  } | null;
  /** Every cited delivery happened after the dispute was opened
   *  (`deliveryPostDatesDispute`). Optional so older callers compile. */
  deliveryPostDatesDispute?: boolean;
}

export const NO_INTERNAL_CONSTRAINTS: InternalNarrativeConstraints = {
  refundOrCompensationRequested: null,
  deliveryPostDatesDispute: false,
};

/**
 * True when every cited delivery date in the approved facts is AFTER the
 * dispute was opened. Then any sentence relating delivery to the dispute's
 * timing is refused (non-receipt plan §6.6 rule 2, Stance rules 2–3):
 * "before the dispute" would be false, "after the dispute" hands the
 * cardholder their argument. cay-collective #14784 (opened 13 Sep, collected
 * 18 Sep) was written "recorded by the carrier prior to the dispute being
 * raised" on 2026-09-23 — a false sentence in a letter scheduled to file.
 */
export function deliveryPostDatesDispute(
  facts: readonly { category: string; value: Record<string, unknown> | null }[],
  disputeOpenedAt: string | null | undefined,
): boolean {
  if (!disputeOpenedAt) return false;
  const opened = Date.parse(disputeOpenedAt);
  if (Number.isNaN(opened)) return false;
  const dates = facts
    .filter((f) => f.category === "delivery_proof" || f.category === "shipping_tracking")
    .map((f) => (typeof f.value?.deliveredAt === "string" ? Date.parse(f.value.deliveredAt) : NaN))
    .filter((d) => !Number.isNaN(d));
  return dates.length > 0 && dates.every((d) => d > opened);
}

/** A sentence that places delivery relative to the dispute, in either direction. */
export const DELIVERY_DISPUTE_TIMING_PATTERNS: readonly RegExp[] = [
  /\b(?:prior\s+to|before|ahead\s+of|preced\w*|after|following|subsequent(?:ly)?\s+to|since)\b[^.;]{0,60}\b(?:dispute|claim|chargeback|inquiry|complaint)\b/i,
  /\b(?:dispute|claim|chargeback|inquiry|complaint)\b[^.;]{0,60}\b(?:after|following|before|prior\s+to|preceded|subsequent)\b[^.;]{0,40}\b(?:deliver\w*|collect\w*|receiv\w*)/i,
];

/**
 * Sentences that deny a refund / reimbursement / compensation request. The
 * item-not-received family bans them unconditionally (the absence can never be
 * verified there); every other family refuses them only when the constraint
 * says a request exists. One list, so the two layers cannot drift apart.
 */
export const REFUND_REQUEST_DENIAL_PATTERNS: readonly RegExp[] = [
  /\bno\s+(?:[a-z]+,\s*)?(?:refund|reimbursement|compensation)\s+request/i,
  /\b(?:has|have|had|did)\s+(?:not|never)\s+(?:yet\s+)?(?:been\s+)?request(?:ed)?\s+(?:a\s+|any\s+)?(?:refund|reimbursement|compensation)/i,
  /\bnever\s+(?:asked|requested)\s+(?:for\s+)?(?:a\s+|any\s+)?(?:refund|reimbursement|compensation)/i,
  /\b(?:refund|reimbursement|compensation)\s+(?:was|has\s+been|had\s+been)\s+(?:never\s+|not\s+)requested/i,
];

export interface ConstraintViolation {
  section: NarrativeSectionKey;
  evidenceText: string;
}

/** Sentences in `text` that the constraints refuse. Empty when unconstrained. */
export function internalConstraintViolations(
  text: string,
  section: NarrativeSectionKey,
  constraints: InternalNarrativeConstraints | null | undefined,
): ConstraintViolation[] {
  if (!text || !constraints) return [];
  const out: ConstraintViolation[] = [];
  if (constraints.refundOrCompensationRequested) {
    for (const pattern of REFUND_REQUEST_DENIAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) out.push({ section, evidenceText: match[0] });
    }
  }
  if (constraints.deliveryPostDatesDispute) {
    for (const pattern of DELIVERY_DISPUTE_TIMING_PATTERNS) {
      const match = text.match(pattern);
      if (match) out.push({ section, evidenceText: match[0] });
    }
  }
  return out;
}
