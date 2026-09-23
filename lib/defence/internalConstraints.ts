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
}

export const NO_INTERNAL_CONSTRAINTS: InternalNarrativeConstraints = {
  refundOrCompensationRequested: null,
};

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
  if (!text || !constraints?.refundOrCompensationRequested) return [];
  const out: ConstraintViolation[] = [];
  for (const pattern of REFUND_REQUEST_DENIAL_PATTERNS) {
    const match = text.match(pattern);
    if (match) out.push({ section, evidenceText: match[0] });
  }
  return out;
}
