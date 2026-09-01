/**
 * Unconfirmed-forwarding detector tests.
 *
 * The two properties that matter: a young save is not a failure, and a
 * confirmed one is never reported. Getting either wrong turns this into noise,
 * and a detector nobody trusts is a detector nobody reads.
 */

import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_GRACE_HOURS,
  classifyUnconfirmedSaves,
  summariseUnconfirmed,
  type DisputeSaveRow,
} from "../unconfirmedForwarding";

const NOW = new Date("2026-09-01T12:00:00.000Z");

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3600_000).toISOString();
}
function hoursAhead(h: number): string {
  return new Date(NOW.getTime() + h * 3600_000).toISOString();
}

function row(overrides: Partial<DisputeSaveRow> = {}): DisputeSaveRow {
  return {
    id: "d-1",
    shop_id: "s-1",
    evidence_saved_to_shopify_at: hoursAgo(72),
    submitted_at: null,
    submission_state: "saved_to_shopify",
    due_at: hoursAhead(120),
    final_outcome: null,
    ...overrides,
  };
}

describe("what is never reported", () => {
  it("ignores a save Shopify has confirmed", () => {
    expect(
      classifyUnconfirmedSaves([row({ submitted_at: hoursAgo(1) })], NOW),
    ).toEqual([]);
    expect(
      classifyUnconfirmedSaves(
        [row({ submission_state: "submitted_confirmed" })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("ignores a save younger than the grace window", () => {
    // A save made an hour ago has not failed; confirmation simply has not
    // arrived yet.
    const young = classifyUnconfirmedSaves(
      [row({ evidence_saved_to_shopify_at: hoursAgo(CONFIRMATION_GRACE_HOURS - 1) })],
      NOW,
    );
    expect(young).toEqual([]);
  });

  it("reports one that has just aged past the window", () => {
    const aged = classifyUnconfirmedSaves(
      [row({ evidence_saved_to_shopify_at: hoursAgo(CONFIRMATION_GRACE_HOURS + 1) })],
      NOW,
    );
    expect(aged).toHaveLength(1);
  });

  it("ignores a decided dispute", () => {
    // Surfacing helps only while the deadline can still be met; the
    // post-outcome analyser owns everything after.
    expect(classifyUnconfirmedSaves([row({ final_outcome: "lost" })], NOW)).toEqual([]);
  });

  it("ignores a dispute never saved at all", () => {
    // That population belongs to defence-package-deadline-submit.
    expect(
      classifyUnconfirmedSaves([row({ evidence_saved_to_shopify_at: null })], NOW),
    ).toEqual([]);
  });

  it("survives an unparseable timestamp instead of throwing", () => {
    expect(
      classifyUnconfirmedSaves([row({ evidence_saved_to_shopify_at: "not a date" })], NOW),
    ).toEqual([]);
  });
});

describe("severity", () => {
  it("calls a passed deadline past_deadline", () => {
    const [s] = classifyUnconfirmedSaves([row({ due_at: hoursAgo(2) })], NOW);
    expect(s.severity).toBe("past_deadline");
    expect(s.hoursToDeadline).toBe(-2);
  });

  it("calls a near deadline due_soon", () => {
    const [s] = classifyUnconfirmedSaves([row({ due_at: hoursAhead(12) })], NOW);
    expect(s.severity).toBe("due_soon");
  });

  it("calls a distant deadline watch", () => {
    const [s] = classifyUnconfirmedSaves([row({ due_at: hoursAhead(200) })], NOW);
    expect(s.severity).toBe("watch");
  });

  it("treats a missing deadline as watch rather than urgent", () => {
    // No deadline is not the same as an expired one, and guessing urgency from
    // absent data is how a detector earns distrust.
    const [s] = classifyUnconfirmedSaves([row({ due_at: null })], NOW);
    expect(s.severity).toBe("watch");
    expect(s.hoursToDeadline).toBeNull();
  });
});

describe("ordering and summary", () => {
  it("puts the most urgent first, then the longest waiting", () => {
    const saves = classifyUnconfirmedSaves(
      [
        row({ id: "watch", due_at: hoursAhead(300) }),
        row({ id: "past", due_at: hoursAgo(5) }),
        row({ id: "soon-new", due_at: hoursAhead(10), evidence_saved_to_shopify_at: hoursAgo(30) }),
        row({ id: "soon-old", due_at: hoursAhead(10), evidence_saved_to_shopify_at: hoursAgo(200) }),
      ],
      NOW,
    );
    expect(saves.map((s) => s.disputeId)).toEqual([
      "past",
      "soon-old",
      "soon-new",
      "watch",
    ]);
  });

  it("counts by severity", () => {
    const saves = classifyUnconfirmedSaves(
      [
        row({ id: "a", due_at: hoursAgo(1) }),
        row({ id: "b", due_at: hoursAgo(2) }),
        row({ id: "c", due_at: hoursAhead(10) }),
        row({ id: "d", due_at: hoursAhead(500) }),
      ],
      NOW,
    );
    expect(summariseUnconfirmed(saves)).toEqual({
      past_deadline: 2,
      due_soon: 1,
      watch: 1,
    });
  });

  it("summarises an empty set as zeroes, not an empty object", () => {
    expect(summariseUnconfirmed([])).toEqual({
      past_deadline: 0,
      due_soon: 0,
      watch: 0,
    });
  });
});
