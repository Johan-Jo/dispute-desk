import { describe, expect, it } from "vitest";
import { resolveDeadlineWindow } from "../deadlineWindow";
import { deadlineWindow, SUBMIT_WINDOW_MARGIN_MS } from "@/lib/cron/deadlineWindow";

const HOUR = 60 * 60 * 1000;

describe("resolveDeadlineWindow", () => {
  it("opens for a pre-08:00 deadline on the run the day before (6a8848-dd #101350)", () => {
    // Scanned by the 10-01 08:00 submit run, refused `before_window`, and the
    // 10-02 08:00 run fires five hours after the deadline.
    const out = resolveDeadlineWindow("2026-10-02T03:00:00+00:00", new Date("2026-10-01T08:00:00Z"));
    expect(out.state).toBe("in_window");
  });

  it("is past_window once the deadline has expired, even on the same UTC day", () => {
    const out = resolveDeadlineWindow("2026-10-02T03:00:00+00:00", new Date("2026-10-02T08:00:00Z"));
    expect(out.state).toBe("past_window");
  });

  it("is before_window beyond the submit cron's horizon", () => {
    const out = resolveDeadlineWindow("2026-10-03T12:00:00Z", new Date("2026-10-01T08:00:00Z"));
    expect(out.state).toBe("before_window");
  });

  it("is unknown without a parseable due date", () => {
    expect(resolveDeadlineWindow(null, new Date()).state).toBe("unknown");
    expect(resolveDeadlineWindow("not a date", new Date()).state).toBe("unknown");
  });

  /* The class: the cron's QUERY window and this adapter's window are one
   * definition. Every due date the query can select must read `in_window`,
   * and every due date just outside it must not. */
  it("agrees with the submit cron's query window at every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      const now = new Date(Date.UTC(2026, 9, 1, h, 17));
      const { from, to } = deadlineWindow(now, SUBMIT_WINDOW_MARGIN_MS);
      for (let t = from.getTime(); t < to.getTime(); t += HOUR) {
        expect(resolveDeadlineWindow(new Date(t).toISOString(), now).state).toBe("in_window");
      }
      expect(resolveDeadlineWindow(new Date(from.getTime() - 1).toISOString(), now).state).toBe("past_window");
      expect(resolveDeadlineWindow(to.toISOString(), now).state).toBe("before_window");
    }
  });
});
