/**
 * The dispute page's timeline lists the return the store has in Shopify, dated by the order's own events.
 * Case: whj8db-1q #24697 (credit not processed, return opened 2026-10-27, nothing refunded) listed the
 * return among the facts but not in "What happened and what comes next".
 */
import { describe, expect, it } from "vitest";
import { buildDisputeRecord, type RecordFormat, type RecordInputs } from "../disputeRecord";

const fmt = {
  money: (n: number, c?: string | null) => `${c ?? ""} ${n}`,
  date: (iso: string) => iso.slice(0, 10),
} as unknown as RecordFormat;

function input(patch: Partial<RecordInputs>): RecordInputs {
  return {
    status: "open",
    view: {
      reason: "CREDIT_NOT_PROCESSED",
      amount: 560,
      currency: "SEK",
      openedAt: "2026-11-04T09:00:00Z",
      dueAt: "2026-11-22T23:00:00Z",
      facts: {},
    },
    now: "2026-11-12T10:00:00Z",
    orderName: "#24697",
    customerName: null,
    cardholderName: null,
    cardNetwork: null,
    cardLast4: null,
    gateway: null,
    strength: null,
    pkg: { version: null, preparedAt: null, filedAt: null },
    lines: [],
    bankCitedFields: null,
    refund: "none",
    timelineEvents: [],
    gorgiasFoundNone: false,
    asks: [],
    automationMode: "auto",
    stage: "held",
    hasPackage: false,
    responder: null,
    sentAt: null,
    savedAt: null,
    reopenedAt: null,
    escalatedAt: null,
    attentionKey: null,
    fatalReason: null,
    returns: "in_progress",
    returnOpenedAt: "2026-10-27T20:18:43Z",
    canDecide: false,
    decision: null,
    ...patch,
  } as unknown as RecordInputs;
}

const titles = (i: RecordInputs) => buildDisputeRecord(i, fmt).timeline.map((t) => (t.title as { key: string }).key);

describe("timeline: the return", () => {
  it("lists the return, dated, between the order and the dispute", () => {
    const k = titles(input({}));
    expect(k).toContain("disputes.record.timeline.t.returnOpened");
    expect(k.indexOf("disputes.record.timeline.t.returnOpened")).toBeLessThan(k.indexOf("disputes.record.timeline.t.opened"));
  });

  it("says nothing without a return on record or without a date", () => {
    expect(titles(input({ returns: "none" }))).not.toContain("disputes.record.timeline.t.returnOpened");
    expect(titles(input({ returnOpenedAt: null }))).not.toContain("disputes.record.timeline.t.returnOpened");
  });
});
