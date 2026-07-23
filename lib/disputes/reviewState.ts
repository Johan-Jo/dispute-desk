/**
 * Canonical values + helpers for `disputes.review_state`.
 *
 * The merchant review lifecycle for a PARKED-for-review or WEAK dispute
 * (2026-07-23 product decision). Before this, such a dispute had no
 * terminal merchant-driven state — it sat in the actionable queue and on
 * the dashboard forever. These three explicit decisions give it one:
 *
 *   in_review — "hold & watch". The merchant is actively working it.
 *               `review_due_at` snapshots the deadline; the reminder cron
 *               resurfaces it (needs_attention) ~48h before the deadline
 *               if it's still untouched, so it can't rot silently.
 *   approved  — "reviewed, submit on the deadline". Clears needs_attention;
 *               the existing 08:00-UTC deadline cron auto-submits it per
 *               the shop's automation rule, as normal.
 *   conceded  — "do not defend". The deadline cron SKIPS it (never
 *               auto-submits); it leaves every actionable view and reads
 *               "Not defended" in history.
 *
 * Billing is NOT affected by any of these — the pack credit is consumed
 * at pack BUILD (finalize), not at submit, so a conceded/held dispute has
 * already been billed and conceding does not refund it (explicit
 * 2026-07-23 decision). See lib/billing/consumePack.ts.
 *
 * Values are validated here in TypeScript; the DB column has no CHECK
 * constraint, matching the `attention_reason` convention.
 */

export const REVIEW_STATES = {
  IN_REVIEW: "in_review",
  APPROVED: "approved",
  CONCEDED: "conceded",
} as const;

export type ReviewState = (typeof REVIEW_STATES)[keyof typeof REVIEW_STATES];

/** The merchant actions that drive `review_state`. `hold` sets
 *  `in_review` (+ snapshots `review_due_at`); `approve` sets `approved`;
 *  `concede` sets `conceded`; `clear` returns the dispute to the
 *  undecided (NULL) state so it rides the shop's automation rule again. */
export type ReviewAction = "hold" | "approve" | "concede" | "clear";

const ACTION_TO_STATE: Record<ReviewAction, ReviewState | null> = {
  hold: REVIEW_STATES.IN_REVIEW,
  approve: REVIEW_STATES.APPROVED,
  concede: REVIEW_STATES.CONCEDED,
  clear: null,
};

/** True for the four accepted action verbs. */
export function isReviewAction(v: unknown): v is ReviewAction {
  return v === "hold" || v === "approve" || v === "concede" || v === "clear";
}

/** Resolve an action verb to the `review_state` it writes (NULL clears). */
export function reviewStateForAction(action: ReviewAction): ReviewState | null {
  return ACTION_TO_STATE[action];
}

/** True for a stored value that is one of the canonical review states. */
export function isReviewState(v: unknown): v is ReviewState {
  return v === "in_review" || v === "approved" || v === "conceded";
}

/** A conceded dispute must never be auto-submitted by the deadline cron. */
export function blocksAutoSubmit(state: string | null | undefined): boolean {
  return state === REVIEW_STATES.CONCEDED;
}

/** Approved / conceded are terminal merchant decisions — the dispute
 *  should leave the actionable ("needs action" / "needs review") views.
 *  `in_review` stays actionable (it's work-in-progress) but is shown with
 *  its own calmer "In review" chip + countdown rather than a red nag. */
export function isTerminalReviewDecision(
  state: string | null | undefined,
): boolean {
  return state === REVIEW_STATES.APPROVED || state === REVIEW_STATES.CONCEDED;
}
