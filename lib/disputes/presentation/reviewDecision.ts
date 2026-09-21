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
  /**
   * The evidence deadline, and the clock to judge it against.
   *
   * ── WHY THE LIFECYCLE ALONE IS NOT ENOUGH ─────────────────────────
   *
   * The lifecycle check above answers "has the decision been carried out?"
   * It cannot answer "can it still be carried out?", and those come apart
   * whenever the deadline passes without the save happening. The pre-save
   * rungs are exactly the ones that never advance in that case, so a
   * decision about the future kept describing a future that had gone.
   *
   * Found on prod 2026-09-21: 6a8848-dd `#90627`, approved, due 30 Aug
   * 03:00 UTC, never filed — three weeks later the list still read
   * "Scheduled to submit — Set to submit automatically on the deadline".
   * Its sibling `#90055` said "Building evidence · No action required" for
   * a window that closed on 26 Aug. Both are casualties of the pre-#736
   * deadline-cron gap (a `due_at` before the 08:00 UTC run was unreachable
   * in both directions), and the UI went on promising the submit that the
   * cron could no longer make.
   *
   * A promise the system cannot keep is worse than no label: the merchant
   * reads "no action required" on the one case that still needed them.
   *
   * Optional so existing callers are unaffected and keep the previous
   * lifecycle-only behaviour. A caller that passes no deadline is saying
   * "I cannot judge the clock", not "the clock has not run out" — this
   * function never invents `now`, for the same reason the rest of this
   * layer takes time as an input rather than reading it.
   */
  deadline?: { evidenceDueAt: string | null | undefined; now: Date },
): T | null {
  if (!reviewState) return null;
  if (lifecycle == null) return reviewState;
  if (!DECISION_PENDING_LIFECYCLES.has(lifecycle)) return null;

  if (deadline?.evidenceDueAt) {
    const due = Date.parse(deadline.evidenceDueAt);
    // An unparseable date is not an expired one — withhold nothing on a
    // value this function cannot read.
    if (Number.isFinite(due) && deadline.now.getTime() > due) return null;
  }

  return reviewState;
}

/**
 * Did this dispute's evidence window close with nothing filed?
 *
 * The same question `effectiveReviewDecision` asks internally, exposed for
 * surfaces that must LABEL the state rather than merely stop rendering a
 * stale decision. Kept here, beside the predicate it mirrors, so the two
 * cannot drift into disagreeing about when a window is missed.
 *
 * `pastDeadlineUnfiled` is deliberately narrow: it says the clock ran out on
 * a pre-save rung. It does NOT claim the dispute is lost — only Shopify can
 * say that, and no copy built on this may assert an outcome.
 */
export function isDeadlineMissedUnfiled(
  lifecycle: OperationalLifecycle | null | undefined,
  evidenceDueAt: string | null | undefined,
  now: Date,
): boolean {
  if (lifecycle == null || !evidenceDueAt) return false;
  if (!DECISION_PENDING_LIFECYCLES.has(lifecycle)) return false;
  const due = Date.parse(evidenceDueAt);
  return Number.isFinite(due) && now.getTime() > due;
}
