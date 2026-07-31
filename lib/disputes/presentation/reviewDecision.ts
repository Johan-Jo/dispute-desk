/**
 * Is a recorded merchant review decision still the CURRENT truth?
 *
 * `disputes.review_state` (in_review / approved / conceded) is a standing
 * decision about what will happen at the deadline — it is deliberately NOT
 * cleared when that decision is carried out. Nothing in the save path
 * resets it: the 08:00-UTC deadline cron saves the evidence and moves
 * `submission_state` to `saved_to_shopify`, leaving `review_state =
 * 'approved'` behind as a historical record of the decision.
 *
 * So every surface that renders the decision must ask whether it is still
 * PENDING before letting it override the lifecycle. Without this check a
 * dispute that was already filed keeps announcing "Scheduled to submit …
 * on the deadline" while the submit tab, the list, and the confirmation
 * email all correctly say it has been submitted (blume-box dispute
 * 0ab14b8f, saved 2026-07-31 08:06 UTC, reported the same morning).
 *
 * Pending = the evidence has not been saved or sent and no outcome exists,
 * i.e. the lifecycle is still one of the pre-save rungs. Once the
 * lifecycle reaches `saved_to_shopify` / `under_review` / a terminal
 * state, the decision has been executed (or overtaken) and the lifecycle
 * copy is the honest thing to show — including for `conceded`, where
 * "Nothing will be submitted" would be false once something was.
 */

import type { OperationalLifecycle } from "./types";

/** Lifecycle rungs in which a recorded decision still describes the
 *  FUTURE. Everything else means it has already played out. */
const DECISION_PENDING_LIFECYCLES: ReadonlySet<OperationalLifecycle> = new Set([
  "building_evidence",
  "monitoring",
  "pack_prepared",
]);

/**
 * The review decision a surface should render, or `null` when the stored
 * decision no longer describes what is happening.
 *
 * Generic in the decision type so callers keep their own narrow union
 * (`"in_review" | "approved" | "conceded"`) without a cast.
 */
export function effectiveReviewDecision<T extends string>(
  lifecycle: OperationalLifecycle | null | undefined,
  reviewState: T | null | undefined,
): T | null {
  if (!reviewState) return null;
  if (lifecycle == null) return reviewState;
  return DECISION_PENDING_LIFECYCLES.has(lifecycle) ? reviewState : null;
}
