/**
 * Responses that went in through Shopify, not through DisputeDesk.
 *
 * Mein Maison (2026-09-27): disputes answered in Shopify Admin showed as
 * "pending" because the only thing we trusted was our own save or Shopify's
 * `evidence_sent_on`, and an inquiry answered in Shopify leaves neither. The
 * status transition is the only observation we get. Plan:
 * docs/plans/mein-maison-status-and-no-return.plan.md, Fix A.
 *
 * `under_review` means three different things, so it is never read alone:
 *
 *   | observation                                          | meaning                         |
 *   |------------------------------------------------------|---------------------------------|
 *   | `under_review`, no deadline                          | Shopify's creation state (A1)   |
 *   | `needs_response → under_review`, deadline set        | responded through Shopify (A2)  |
 *   | first seen `under_review` with a deadline, no signal | under review, responder unknown |
 *
 * The actor is always Shopify: we cannot tell a merchant's Admin response
 * from Shopify's own filing, so no copy ever says who sent it.
 */

import { hasRealDeadline } from "./responseCycle";

export const RESPONDED_VIA_SHOPIFY = "responded_via_shopify";
export const UNDER_REVIEW_UNATTRIBUTED = "under_review_unattributed";

/** Submission states recorded from a Shopify status, not from a save. */
export const SHOPIFY_OBSERVED_RESPONSE_STATES: ReadonlySet<string> = new Set([
  RESPONDED_VIA_SHOPIFY,
  UNDER_REVIEW_UNATTRIBUTED,
]);

export function isShopifyObservedResponseState(state: string | null | undefined): boolean {
  return state != null && SHOPIFY_OBSERVED_RESPONSE_STATES.has(state);
}

/**
 * A1: Shopify creates a dispute as `under_review` with no deadline and moves
 * it to `needs_response` minutes later. Nothing has been answered; the
 * dispute is new and a pack may be built.
 */
export function isAwaitingShopifyDeadline(input: {
  status: string | null | undefined;
  dueAt: string | null | undefined;
}): boolean {
  return input.status === "under_review" && !hasRealDeadline(input.dueAt);
}

/** Our own records say nothing was sent (or say nothing at all). */
function nothingSentByUs(state: string | null | undefined): boolean {
  return state == null || state === "not_saved";
}

/**
 * A2, live transition: Shopify moved the dispute from `needs_response` to
 * `under_review` with a deadline set, and DisputeDesk sent nothing.
 */
export function observesResponseViaShopify(input: {
  oldStatus: string | null | undefined;
  newStatus: string | null | undefined;
  newDueAt: string | null | undefined;
  submissionState: string | null | undefined;
  closed: boolean;
}): boolean {
  if (input.closed) return false;
  if (input.oldStatus !== "needs_response") return false;
  if (input.newStatus !== "under_review") return false;
  if (!hasRealDeadline(input.newDueAt)) return false;
  return nothingSentByUs(input.submissionState);
}

/**
 * A2, first observation: the dispute is `under_review` with a deadline when
 * we first see it, and there is no submission signal. Shopify says it is under
 * review; we don't know who responded, or whether anyone did.
 */
export function isUnattributedUnderReview(input: {
  status: string | null | undefined;
  dueAt: string | null | undefined;
  evidenceSentOn: string | null | undefined;
}): boolean {
  return (
    input.status === "under_review" &&
    hasRealDeadline(input.dueAt) &&
    !input.evidenceSentOn
  );
}

/**
 * Shopify asks again (`needs_response`) after a response it observed. When
 * the deadline is unchanged this is an inquiry's messaging back-and-forth
 * (#99143: three flips in four days with the same deadline), not a reopen:
 * the observed response simply no longer settles it, and the dispute is
 * back to "needs a response" in the SAME cycle.
 */
export function isSameCycleAskAgain(input: {
  submissionState: string | null | undefined;
  oldDueAt: string | null | undefined;
  newStatus: string | null | undefined;
  newDueAt: string | null | undefined;
}): boolean {
  if (input.newStatus !== "needs_response") return false;
  if (!isShopifyObservedResponseState(input.submissionState)) return false;
  return sameInstant(input.oldDueAt, input.newDueAt);
}

export function sameInstant(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return new Date(a).getTime() === new Date(b).getTime();
}
