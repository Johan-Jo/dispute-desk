/**
 * The ONLY module in the automation branch allowed to know what time it is.
 *
 * The decision carries an ABSOLUTE `evidenceDueAt` and nothing else time-
 * shaped. Turning that instant into "is the deadline window open right now" is
 * an EXECUTION concern, computed here, at execution, from the absolute date the
 * decision carries. Keeping it in one named module is what makes the
 * time-invariance test meaningful: if relative time appeared inside the
 * decision instead, the stored hash would drift every day and every consumer
 * would silently disagree about staleness.
 *
 * The window IS the deadline submit cron's scan — `deadlineWindow(now,
 * SUBMIT_WINDOW_MARGIN_MS)` from `lib/cron/deadlineWindow.ts`, the ONE
 * definition — so the adapter and the query that feeds it cannot disagree
 * about which cases are in scope.
 *
 * It used to be a second, private definition: "the UTC day on which `due_at`
 * falls". PR #736 moved the cron's QUERY to a rolling window and left this one
 * on the calendar day, so a deadline before 08:00 UTC was scanned by the run
 * the day before and then refused here as `before_window` — and the next run
 * fires after it expires. 2026-10-01: 6a8848-dd #101350, due 10-02 03:00 UTC,
 * scanned at 10-01 08:00, refused `deadline_only_not_yet_due`.
 */

import { deadlineWindow, SUBMIT_WINDOW_MARGIN_MS } from "@/lib/cron/deadlineWindow";

export type DeadlineWindowState =
  /** No due date recorded. The deadline trigger has nothing to act on. */
  | "unknown"
  /** The due date is beyond this run's horizon. A later run files it. */
  | "before_window"
  /** The due date is within `[now, now + 24h + margin)`. The window is open. */
  | "in_window"
  /** The due date has passed. Too late to file. */
  | "past_window";

export interface DeadlineWindow {
  state: DeadlineWindowState;
  /** Echoed back so callers log the absolute instant, never a duration. */
  dueAt: string | null;
}

export function resolveDeadlineWindow(
  evidenceDueAt: string | null | undefined,
  now: Date,
): DeadlineWindow {
  if (!evidenceDueAt) return { state: "unknown", dueAt: null };
  const due = new Date(evidenceDueAt);
  if (Number.isNaN(due.getTime())) return { state: "unknown", dueAt: null };

  const { from, to } = deadlineWindow(now, SUBMIT_WINDOW_MARGIN_MS);
  if (due < from) return { state: "past_window", dueAt: evidenceDueAt };
  if (due >= to) return { state: "before_window", dueAt: evidenceDueAt };
  return { state: "in_window", dueAt: evidenceDueAt };
}

export function isDeadlineWindowOpen(
  evidenceDueAt: string | null | undefined,
  now: Date,
): boolean {
  return resolveDeadlineWindow(evidenceDueAt, now).state === "in_window";
}
