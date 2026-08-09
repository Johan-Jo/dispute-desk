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
 * The window matches the deadline cron's existing scan exactly — the UTC day on
 * which `due_at` falls — so the adapter and the query that feeds it cannot
 * disagree about which cases are in scope.
 */

export type DeadlineWindowState =
  /** No due date recorded. The deadline trigger has nothing to act on. */
  | "unknown"
  /** The due date is on a later UTC day. Nothing files yet. */
  | "before_window"
  /** `now` falls on the same UTC day as the due date. The window is open. */
  | "in_window"
  /** The due date's UTC day has passed. Too late to file. */
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

  const dueDay = utcDayStart(due);
  const nowDay = utcDayStart(now);

  if (nowDay < dueDay) return { state: "before_window", dueAt: evidenceDueAt };
  if (nowDay > dueDay) return { state: "past_window", dueAt: evidenceDueAt };
  return { state: "in_window", dueAt: evidenceDueAt };
}

export function isDeadlineWindowOpen(
  evidenceDueAt: string | null | undefined,
  now: Date,
): boolean {
  return resolveDeadlineWindow(evidenceDueAt, now).state === "in_window";
}

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
