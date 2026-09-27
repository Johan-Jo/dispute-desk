/**
 * History reconstruction for the response-cycle repair (plan B3/B4), on the
 * two prod shapes that motivated it. The property that matters: history and
 * the live path derive the SAME anchor for the same reopen, so running the
 * repair in either order — or twice — yields one ledger row per cycle.
 */

import { describe, it, expect } from "vitest";
import {
  planHistoryCycles,
  planHistoryCyclesAgainstLedger,
  type ObservedState,
} from "@/lib/disputes/responseCycleHistory";
import { responseAnchorKey, type PriorResponseRow } from "@/lib/disputes/responseCycle";

// #99142 (6a8848-dd): created, deadline set, answered 09-22 (evidence_sent_on
// in the payload), reopened 09-23 with the same 10-01 deadline.
const H_99142: ObservedState[] = [
  { at: "2026-09-21T09:35:47Z", status: "under_review", type: "chargeback", evidenceDueBy: null, evidenceSentOn: null },
  { at: "2026-09-21T09:37:14Z", status: "needs_response", type: "chargeback", evidenceDueBy: "2026-10-01T05:00:00+02:00", evidenceSentOn: null },
  { at: "2026-09-21T23:05:13Z", status: "needs_response", type: "chargeback", evidenceDueBy: "2026-10-01T05:00:00+02:00", evidenceSentOn: null },
  { at: "2026-09-22T06:20:15Z", status: "under_review", type: "chargeback", evidenceDueBy: "2026-10-01T05:00:00+02:00", evidenceSentOn: "2026-09-22T08:20:13+02:00" },
  { at: "2026-09-23T10:50:51Z", status: "needs_response", type: "chargeback", evidenceDueBy: "2026-10-01T05:00:00+02:00", evidenceSentOn: null },
];
const ROW_99142: PriorResponseRow = {
  status: "needs_response",
  due_at: "2026-10-01T03:00:00Z",
  submitted_at: "2026-09-22T06:20:13+00:00",
  submission_state: "submitted_confirmed",
  evidence_saved_to_shopify_at: null,
  shopify_updated_at: null,
};

// #99348: webhook history starts late (answered state, NO evidence_sent_on in
// the payload); the GraphQL sync had recorded submitted_at 09-16.
const H_99348: ObservedState[] = [
  { at: "2026-09-25T08:16:48Z", status: "under_review", type: "chargeback", evidenceDueBy: "2026-09-16T05:00:00+02:00", evidenceSentOn: null },
  { at: "2026-09-25T08:18:36Z", status: "needs_response", type: "chargeback", evidenceDueBy: "2026-10-05T05:00:00+02:00", evidenceSentOn: null },
];
const ROW_99348: PriorResponseRow = {
  status: "needs_response",
  due_at: "2026-10-05T03:00:00Z",
  submitted_at: "2026-09-16T05:45:23+00:00",
  submission_state: "submitted_confirmed",
  evidence_saved_to_shopify_at: null,
  shopify_updated_at: null,
};

/** In-memory model of reconcile_response_cycle's ledger semantics. */
function ledger() {
  const rows = new Map<string, string>(); // anchor -> startedAt
  return {
    reconcile(anchorKey: string, startedAt: string) {
      if (rows.has(anchorKey)) return false;
      rows.set(anchorKey, startedAt);
      return true;
    },
    cycle: () => 1 + rows.size,
    rows,
  };
}

describe("planHistoryCycles", () => {
  it("#99142: one reopen, anchored on the evidence_sent_on the live row also holds", () => {
    const plan = planHistoryCycles(H_99142, ROW_99142);
    expect(plan.cycles).toEqual([
      { anchorKey: "resp:2026-09-22T06:20:13Z", startedAt: "2026-09-23T10:50:51Z", trigger: "reopen" },
    ]);
    expect(plan.cycles[0]!.anchorKey).toBe(responseAnchorKey(ROW_99142));
  });

  it("the creation state (under_review, no deadline) followed by needs_response is NOT a reopen", () => {
    const plan = planHistoryCycles(H_99142.slice(0, 3), ROW_99142);
    expect(plan.cycles).toEqual([]);
  });

  it("#99348: payload lacks evidence_sent_on, so the last reopen anchors on the row like the live path", () => {
    const plan = planHistoryCycles(H_99348, ROW_99348);
    expect(plan.cycles).toHaveLength(1);
    expect(plan.cycles[0]!.anchorKey).toBe("resp:2026-09-16T05:45:23Z");
    expect(plan.cycles[0]!.anchorKey).toBe(responseAnchorKey(ROW_99348));
  });

  it("an answered inquiry escalated to a chargeback is planned as an escalation", () => {
    const plan = planHistoryCycles(
      [
        { at: "2026-09-01T00:00:00Z", status: "needs_response", type: "inquiry", evidenceDueBy: "2026-09-10T00:00:00Z" },
        { at: "2026-09-05T00:00:00Z", status: "under_review", type: "inquiry", evidenceDueBy: "2026-09-10T00:00:00Z", evidenceSentOn: "2026-09-05T00:00:00Z" },
        { at: "2026-09-20T00:00:00Z", status: "needs_response", type: "chargeback", evidenceDueBy: "2026-10-05T00:00:00Z" },
      ],
      { status: "needs_response", due_at: "2026-10-05T00:00:00Z", submitted_at: "2026-09-05T00:00:00Z", submission_state: "submitted_confirmed" },
    );
    expect(plan.escalatedAt).toBe("2026-09-20T00:00:00Z");
    expect(plan.cycles).toEqual([
      { anchorKey: "resp:2026-09-05T00:00:00Z", startedAt: "2026-09-20T00:00:00Z", trigger: "escalation" },
    ]);
  });

  it("two reopens produce two cycles with distinct anchors", () => {
    const plan = planHistoryCycles(
      [
        { at: "2026-09-01T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-10T00:00:00Z" },
        { at: "2026-09-02T00:00:00Z", status: "under_review", evidenceDueBy: "2026-09-10T00:00:00Z", evidenceSentOn: "2026-09-02T00:00:00Z" },
        { at: "2026-09-05T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-15T00:00:00Z" },
        { at: "2026-09-06T00:00:00Z", status: "under_review", evidenceDueBy: "2026-09-15T00:00:00Z", evidenceSentOn: "2026-09-06T00:00:00Z" },
        { at: "2026-09-09T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-25T00:00:00Z" },
      ],
      { status: "needs_response", due_at: "2026-09-25T00:00:00Z", submitted_at: "2026-09-06T00:00:00Z", submission_state: "submitted_confirmed" },
    );
    expect(plan.cycles.map((c) => c.anchorKey)).toEqual([
      "resp:2026-09-02T00:00:00Z",
      "resp:2026-09-06T00:00:00Z",
    ]);
  });

  it("dispute_events source (no deadlines recorded) still finds the reopen", () => {
    const plan = planHistoryCycles(
      [
        { at: "2026-09-21T09:37:14Z", status: "needs_response" },
        { at: "2026-09-22T06:20:15Z", status: "under_review" },
        { at: "2026-09-23T10:50:51Z", status: "needs_response" },
      ],
      ROW_99142,
      false,
    );
    expect(plan.cycles).toHaveLength(1);
    expect(plan.cycles[0]!.anchorKey).toBe(responseAnchorKey(ROW_99142));
  });
});

describe("history and live agree, in either order and when repeated (review 3, point 1)", () => {
  for (const [name, history, row] of [
    ["#99142", H_99142, ROW_99142],
    ["#99348", H_99348, ROW_99348],
  ] as const) {
    it(`${name}: history → live → history → live ends on cycle 2 with one ledger row`, () => {
      const l = ledger();
      const plan = planHistoryCycles(history, row);
      const liveAnchor = responseAnchorKey(row)!;
      const liveStart = plan.cycles[plan.cycles.length - 1]!.startedAt;

      for (const c of plan.cycles) l.reconcile(c.anchorKey, c.startedAt);
      l.reconcile(liveAnchor, liveStart);
      for (const c of plan.cycles) l.reconcile(c.anchorKey, c.startedAt);
      l.reconcile(liveAnchor, liveStart);

      expect(l.cycle()).toBe(2);
      expect([...l.rows.values()]).toEqual([liveStart]);
    });

    it(`${name}: live → history ends on the same single row`, () => {
      const l = ledger();
      const plan = planHistoryCycles(history, row);
      const liveAnchor = responseAnchorKey(row)!;
      l.reconcile(liveAnchor, plan.cycles[0]!.startedAt);
      for (const c of plan.cycles) expect(l.reconcile(c.anchorKey, c.startedAt)).toBe(false);
      expect(l.cycle()).toBe(2);
    });
  }
});

describe("planHistoryCyclesAgainstLedger", () => {
  it("#99348 after the live repair reset the row: the recorded cycle is not planned again", () => {
    // The live repair ran first: the row no longer holds submitted_at, so the
    // anchor history derives differs from the one the ledger holds.
    const resetRow = { ...ROW_99348, submitted_at: null, submission_state: "not_saved" };
    const liveStart = "2026-09-27T12:00:00Z"; // the repair saw it later than the webhook
    const plan = planHistoryCyclesAgainstLedger(H_99348, resetRow, [liveStart]);
    expect(plan.cycles).toEqual([]);
  });

  it("an earlier, unrecorded reopen is still planned when a later one is recorded", () => {
    const states: ObservedState[] = [
      { at: "2026-09-01T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-10T00:00:00Z" },
      { at: "2026-09-02T00:00:00Z", status: "under_review", evidenceDueBy: "2026-09-10T00:00:00Z", evidenceSentOn: "2026-09-02T00:00:00Z" },
      { at: "2026-09-05T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-15T00:00:00Z" },
      { at: "2026-09-06T00:00:00Z", status: "under_review", evidenceDueBy: "2026-09-15T00:00:00Z", evidenceSentOn: "2026-09-06T00:00:00Z" },
      { at: "2026-09-09T00:00:00Z", status: "needs_response", evidenceDueBy: "2026-09-25T00:00:00Z" },
    ];
    const plan = planHistoryCyclesAgainstLedger(
      states,
      { status: "needs_response", due_at: "2026-09-25T00:00:00Z", submitted_at: null, submission_state: "not_saved" },
      ["2026-09-09T00:30:00Z"],
    );
    expect(plan.cycles.map((c) => c.startedAt)).toEqual(["2026-09-05T00:00:00Z"]);
  });
});
