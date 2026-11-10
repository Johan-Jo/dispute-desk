/**
 * d65b7220 (v18, 2026-11-10): the later order was placed the day after the
 * inquiry opened. True, but the ledger only carried delivery-relative
 * intervals, so the writer derived "the day after the inquiry was opened"
 * itself and the fact-check reviewer rejected it as unsupported. The ledger
 * now computes the dispute-relative interval too, and tells the writer to
 * name its anchor.
 */
import { describe, expect, it } from "vitest";

import { buildItemNotReceivedLedger } from "../claimLedger";
import { reviewUserPrompt } from "../prompts";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

function input(laterPlacedAt: string): LedgerInput {
  const facts = [
    {
      id: "f1",
      category: "delivery_proof",
      value: { proofType: "delivered_confirmed", carrier: "Northwind Post", trackingNumber: "T1", deliveredAt: "2026-07-06T19:53:02Z" },
    },
  ] as unknown as EvidenceFact[];
  return {
    moduleKey: "inr_product_not_received",
    facts,
    packSections: [
      { type: "order", data: { orderName: "#1", createdAt: "2026-07-02T05:33:17Z" } },
      { type: "shipping", data: { fulfillments: [{ createdAt: "2026-07-02T16:22:00Z", tracking: [{ number: "T1" }] }] } },
    ],
    orderName: "#1",
    disputeOpenedAt: "2026-10-26T10:00:00Z",
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [
      { name: "#1", createdAt: "2026-07-02T05:33:17Z", financialStatus: "PAID", fulfillmentStatus: "FULFILLED", cancelled: false, deliveredAt: "2026-07-06T19:53:02Z", carrier: "Northwind Post", cardLast4: "3627", wallet: null },
      { name: "#2", createdAt: laterPlacedAt, financialStatus: "PAID", fulfillmentStatus: "FULFILLED", cancelled: false, deliveredAt: null, carrier: null, cardLast4: "3627", wallet: null },
    ],
  };
}
const later = (i: LedgerInput) => buildItemNotReceivedLedger(i)!.find((c) => c.id === "later_order")!;

describe("later order placed after the dispute opened", () => {
  it("carries the dispute-relative interval, anchored", () => {
    const c = later(input("2026-10-27T12:00:00Z"));
    expect(c.specifics.laterOrderAfterDispute).toBe("yes");
    expect(c.specifics.daysAfterDisputeOpened).toBe("1");
    expect(c.specifics.daysAfterDisputeOpenedWord).toBe("one");
    expect(c.statement).toContain("one day after this dispute was opened");
    expect(c.specifics.daysBeforeDispute).toBeUndefined();
    expect(c.mustNot.join(" ")).toMatch(/never a bare "the following day"/);
  });

  it("is visible to the reviewer, so the sentence is supported", () => {
    const prompt = reviewUserPrompt(buildItemNotReceivedLedger(input("2026-10-27T12:00:00Z"))!, ["x"], "");
    expect(prompt).toContain("one day(s) after the dispute was opened");
  });

  it("adds nothing when the later order is before the dispute", () => {
    const c = later(input("2026-10-20T12:00:00Z"));
    expect(c.specifics.laterOrderAfterDispute).toBeUndefined();
    expect(c.specifics.daysAfterDisputeOpened).toBeUndefined();
    expect(c.specifics.daysBeforeDispute).toBe("6");
    expect(c.statement).not.toContain("after this dispute was opened");
  });
});
