/**
 * The deadline crons' selection window.
 *
 * Regression origin: dispute 4b81afe1 (#98141), due 2026-09-17 03:00 UTC.
 * Both deadline crons selected `due_at` by CALENDAR DAY in UTC while running
 * at a fixed hour, so any deadline earlier than that hour was invisible on the
 * day before and already expired on the day itself. Measured on prod
 * 2026-09-16: 321 disputes carry an 03:00 UTC deadline.
 *
 * These tests pin the two properties that fix requires — no expired selection,
 * and every deadline seen by at least one run before it expires — plus the
 * rebuild-leads-submit ordering.
 */

import { describe, it, expect } from "vitest";
import {
  deadlineWindow,
  SUBMIT_WINDOW_MARGIN_MS,
  REBUILD_WINDOW_MARGIN_MS,
} from "@/lib/cron/deadlineWindow";

/** Does a cron run at `runAt` with `margin` select a deadline at `dueAt`? */
function selects(runAt: string, dueAt: string, margin: number): boolean {
  const { from, to } = deadlineWindow(new Date(runAt), margin);
  const due = new Date(dueAt);
  return due >= from && due < to;
}

/** The daily run times, from vercel.json. */
const SUBMIT_HOUR = "08:00:00Z";
const REBUILD_HOUR = "06:00:00Z";

describe("deadlineWindow", () => {
  it("never selects an already-expired deadline", () => {
    // 09-17 03:00 is five hours behind the 09-17 08:00 run. The old
    // calendar-day window selected it anyway and tried to file after Shopify
    // had closed the window.
    expect(
      selects(`2026-09-17T${SUBMIT_HOUR}`, "2026-09-17T03:00:00Z", SUBMIT_WINDOW_MARGIN_MS),
    ).toBe(false);

    // One second in the past is still the past.
    expect(
      selects("2026-09-17T08:00:00Z", "2026-09-17T07:59:59Z", SUBMIT_WINDOW_MARGIN_MS),
    ).toBe(false);
  });

  it("selects the 4b81afe1 case on the run BEFORE its deadline", () => {
    // The regression case. 09-16 08:00 run, deadline 09-17 03:00 — 19h ahead.
    // Under the old calendar-day window this was a miss, and the dispute was
    // never reachable by any run while its window was open.
    expect(
      selects(`2026-09-16T${SUBMIT_HOUR}`, "2026-09-17T03:00:00Z", SUBMIT_WINDOW_MARGIN_MS),
    ).toBe(true);
  });

  it.each([
    ["00:00", "2026-09-17T00:00:00Z"],
    ["03:00", "2026-09-17T03:00:00Z"],
    ["07:59", "2026-09-17T07:59:00Z"],
    ["08:00", "2026-09-17T08:00:00Z"],
    ["12:00", "2026-09-17T12:00:00Z"],
    ["23:59", "2026-09-17T23:59:00Z"],
  ])(
    "a deadline at %s is seen by at least one run before it expires",
    (_label, dueAt) => {
      const due = new Date(dueAt);
      // Every daily run in the week leading up to the deadline.
      const runs: string[] = [];
      for (let daysBefore = 7; daysBefore >= 0; daysBefore--) {
        const d = new Date(due.getTime() - daysBefore * 24 * 60 * 60 * 1000);
        runs.push(
          `${d.toISOString().slice(0, 10)}T${SUBMIT_HOUR}`,
        );
      }
      const reachable = runs.filter(
        (runAt) =>
          new Date(runAt) < due &&
          selects(runAt, dueAt, SUBMIT_WINDOW_MARGIN_MS),
      );
      expect(reachable.length).toBeGreaterThan(0);
    },
  );

  it("horizon exceeds the 24h cron interval, so no deadline falls between runs", () => {
    const { from, to } = deadlineWindow(new Date("2026-09-16T08:00:00Z"), SUBMIT_WINDOW_MARGIN_MS);
    const spanMs = to.getTime() - from.getTime();
    expect(spanMs).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("rebuild horizon LEADS submit, so a pack is rebuilt before it is filed", () => {
    expect(REBUILD_WINDOW_MARGIN_MS).toBeGreaterThan(SUBMIT_WINDOW_MARGIN_MS);

    // Anything the submit cron will consider has already been offered to the
    // rebuild cron — checked at both routes' real run times on the same day.
    const dueAt = "2026-09-17T03:00:00Z";
    expect(selects(`2026-09-16T${SUBMIT_HOUR}`, dueAt, SUBMIT_WINDOW_MARGIN_MS)).toBe(true);
    expect(selects(`2026-09-16T${REBUILD_HOUR}`, dueAt, REBUILD_WINDOW_MARGIN_MS)).toBe(true);
  });

  it("lower bound is exactly `now`, not the start of the UTC day", () => {
    const now = new Date("2026-09-16T14:37:12Z");
    const { from } = deadlineWindow(now, SUBMIT_WINDOW_MARGIN_MS);
    expect(from.toISOString()).toBe(now.toISOString());
  });

  it("is not affected by the run's position in the UTC day", () => {
    // The old bug was entirely a function of run-hour vs due-hour. A rolling
    // window must give the same relative reach whenever it runs.
    for (const runHour of ["00:30", "06:00", "08:00", "23:45"]) {
      const runAt = `2026-09-16T${runHour}:00Z`;
      const dueAt = new Date(new Date(runAt).getTime() + 20 * 60 * 60 * 1000).toISOString();
      expect(selects(runAt, dueAt, SUBMIT_WINDOW_MARGIN_MS)).toBe(true);
    }
  });
});
