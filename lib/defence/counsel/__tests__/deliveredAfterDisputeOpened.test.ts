/**
 * Non-receipt plan §10 test 17 (maintainer, 2026-09-29): delivery recorded
 * AFTER the dispute was opened → the delivery leads and the filing date is not
 * cited — not in the ledger, not in the chronology. Trigger: Mein Maison
 * #100463, "The dispute was opened on 19 September 2026, and the carrier
 * recorded delivery on 28 September 2026."
 */
import { describe, expect, it } from "vitest";
import { buildItemNotReceivedLedger } from "../claimLedger";
import { addDisputeOpenedRow } from "../run";
import { buildChronologyEvents } from "../../chronology";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

const deliveredAt = "2026-09-28T10:00:00Z";
const facts = [
  {
    id: "f1",
    category: "delivery_proof",
    value: { proofType: "delivered_confirmed", carrier: "DHL", trackingNumber: "T1", deliveredAt },
  },
] as unknown as EvidenceFact[];

function input(disputeOpenedAt: string): LedgerInput {
  return {
    moduleKey: "inr_product_not_received",
    facts,
    packSections: [
      { type: "order", data: { orderName: "#1", createdAt: "2026-09-01T10:00:00Z" } },
      { type: "shipping", data: { fulfillments: [{ createdAt: "2026-09-02T10:00:00Z", tracking: [{ number: "T1" }] }] } },
    ],
    orderName: "#1",
    disputeOpenedAt,
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [],
  };
}
const frame = { provider: "paypal", providerName: "PayPal", stage: "chargeback" } as never;

describe("delivered after the dispute was opened", () => {
  it("the ledger carries no dispute date", () => {
    const ledger = buildItemNotReceivedLedger(input("2026-09-19T12:00:00Z"))!;
    const c = ledger.find((x) => x.id === "delivered_after_dispute_opened")!;
    expect(c.statement).not.toMatch(/September 2026, after|opened/);
    expect(c.specifics).toEqual({});
    expect(JSON.stringify(ledger)).not.toMatch(/19 September/);
  });

  it("no dispute-opened row joins the chronology", () => {
    const i = input("2026-09-19T12:00:00Z");
    const ledger = buildItemNotReceivedLedger(i)!;
    addDisputeOpenedRow(ledger, i.packSections, i.disputeOpenedAt, frame);
    expect(ledger.some((c) => c.id === "dispute_opened")).toBe(false);
    expect(ledger.some((c) => c.timelineEvent?.at === "2026-09-19T12:00:00Z")).toBe(false);
  });

  it("delivered BEFORE the dispute keeps the full sequence", () => {
    const i = input("2026-10-05T12:00:00Z");
    const ledger = buildItemNotReceivedLedger(i)!;
    addDisputeOpenedRow(ledger, i.packSections, i.disputeOpenedAt, frame);
    expect(ledger.some((c) => c.id === "dispute_after_delivery")).toBe(true);
    expect(ledger.some((c) => c.timelineEvent?.at === "2026-10-05T12:00:00Z")).toBe(true);
  });

  it("chronology drops Shopify's opening line when a delivery came after it", () => {
    const ev = buildChronologyEvents(
      {
        timelineEvents: [
          { at: "2026-09-01T10:00:00Z", text: "Anna placed this order on Online Store." },
          { at: "2026-09-19T12:00:00Z", text: "A customer opened a chargeback totaling €50.00." },
        ],
      } as never,
      facts,
    );
    expect(ev.some((e) => /chargeback/i.test(e.text))).toBe(false);
  });

  it("chronology keeps the opening line when delivery came first", () => {
    const ev = buildChronologyEvents(
      {
        timelineEvents: [
          { at: "2026-09-01T10:00:00Z", text: "Anna placed this order on Online Store." },
          { at: "2026-10-05T12:00:00Z", text: "A customer opened a chargeback totaling €50.00." },
        ],
      } as never,
      facts,
    );
    expect(ev.some((e) => /chargeback/i.test(e.text))).toBe(true);
  });
});
