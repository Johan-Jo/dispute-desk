/**
 * The dispute page's timeline lists the return the store has in Shopify, dated by the order's own events.
 * Case: whj8db-1q #24697 (credit not processed, return opened 2026-10-27, nothing refunded) listed the
 * return among the facts but not in "What happened and what comes next".
 */
import { describe, expect, it } from "vitest";
import { buildDisputeRecord, type RecordInputs } from "../disputeRecord";
import { createRecordFormat, parseRecordInstant, type RecordFormat } from "../recordFormat";

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


/**
 * whj8db-1q #24697: DHL's delivery came as "2026-10-27T18:25:00" (no zone) and the return was created at
 * 2026-10-27T20:18:43Z. `Date.parse` read the zone-less time in the VIEWER'S zone, so for a viewer in Sao Paulo
 * (UTC-3) the delivery became 21:25 UTC and the timeline put the return BEFORE the delivery it follows.
 */
describe("timeline: carrier times without a zone", () => {
  const deliveredFacts = { shipping_tracking: { proofType: "delivered_confirmed", deliveredAt: "2026-10-27T18:25:00" } };

  it("a zone-less time is one fixed instant (UTC) for every viewer", () => {
    expect(parseRecordInstant("2026-10-27T18:25:00")).toBe(Date.UTC(2026, 9, 27, 18, 25, 0));
    expect(parseRecordInstant("2026-10-27 18:25:00")).toBe(Date.UTC(2026, 9, 27, 18, 25, 0));
    expect(parseRecordInstant("2026-10-27T18:25")).toBe(Date.UTC(2026, 9, 27, 18, 25, 0));
    expect(parseRecordInstant("2026-10-27T18:25:00.500")).toBe(Date.UTC(2026, 9, 27, 18, 25, 0, 500));
  });

  it("explicit zones and date-only strings read exactly as before", () => {
    expect(parseRecordInstant("2026-10-27T20:18:43Z")).toBe(Date.UTC(2026, 9, 27, 20, 18, 43));
    expect(parseRecordInstant("2026-10-27T20:18:43+02:00")).toBe(Date.UTC(2026, 9, 27, 18, 18, 43));
    expect(parseRecordInstant("2026-10-27")).toBe(Date.UTC(2026, 9, 27));
    expect(Number.isNaN(parseRecordInstant("not a date"))).toBe(true);
  });

  it("the delivery lists before the return that was created later the same day", () => {
    const k = titles(input({ view: { ...input({}).view, facts: deliveredFacts } as RecordInputs["view"] }));
    expect(k.indexOf("disputes.record.timeline.t.delivered")).toBeGreaterThanOrEqual(0);
    expect(k.indexOf("disputes.record.timeline.t.delivered")).toBeLessThan(k.indexOf("disputes.record.timeline.t.returnOpened"));
  });

  it("the day shown for a late-evening zone-less time does not shift with the viewer's zone", () => {
    const f = createRecordFormat("en");
    expect(f.date("2026-10-27T23:30:00")).toBe("27 Oct 2026");
    expect(f.date("2026-10-27T00:10:00")).toBe("27 Oct 2026");
  });
});
