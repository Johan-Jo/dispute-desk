import { describe, expect, it } from "vitest";
import { buildItemNotReceivedLedger, deliveryPeriodDays } from "../claimLedger";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

const policy = (text: string) => ({ type: "shipping_policy", data: { policies: [{ textPreview: text }] } });

function input(laterDeliveredAt: string | null, policyText = "Orders will ship within 1-3 business days."): LedgerInput {
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
      policy(policyText),
    ],
    orderName: "#1",
    disputeOpenedAt: "2026-09-19T02:52:00Z",
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [
      { name: "#1", createdAt: "2026-07-02T05:33:17Z", financialStatus: "PAID", fulfillmentStatus: "FULFILLED", cancelled: false, deliveredAt: "2026-07-06T19:53:02Z", carrier: "Northwind Post", cardLast4: "3627", wallet: "APPLE_PAY" },
      { name: "#2", createdAt: "2026-09-05T03:04:27Z", financialStatus: "PAID", fulfillmentStatus: "FULFILLED", cancelled: false, deliveredAt: laterDeliveredAt, carrier: "Northwind Post", cardLast4: "3627", wallet: "APPLE_PAY", total: "CAD 109.67" },
    ],
  };
}
const later = (i: LedgerInput) => buildItemNotReceivedLedger(i)!.find((c) => c.id === "later_order")!;

describe("later order's delivery date (merchant's delivery period)", () => {
  it("is left out when it took longer than the delivery period (#363341: 16 days)", () => {
    const c = later(input("2026-09-21T19:42:52Z"));
    expect(c.laterOrderExhibit!.deliveredAt).toBeNull();
    expect(c.specifics.laterOrderDeliveredOn).toBeUndefined();
    expect(c.statement).not.toMatch(/delivered on/);
  });

  it("is shown when it arrived within the period", () => {
    const c = later(input("2026-09-09T12:00:00Z"));
    expect(c.laterOrderExhibit!.deliveredAt).toBe("2026-09-09T12:00:00Z");
    expect(c.specifics.laterOrderDeliveredOn).toBe("9 September 2026");
  });

  it("uses a published delivery window before the dispatch window", () => {
    const S = [policy("Orders ship in 1-2 business days and are delivered within 14 days.")];
    expect(deliveryPeriodDays(S, "2026-09-05T00:00:00Z", null, "2026-09-06T00:00:00Z")).toBe(14);
  });

  it("dispatch window (business days) plus the disputed order's transit", () => {
    // Thu 2 Jul + 3 business days = Tue 7 Jul (5 calendar days); transit 2 Jul → 6 Jul = 4.
    const S = [policy("Orders will ship within 1-3 business days.")];
    expect(deliveryPeriodDays(S, "2026-07-02T05:33:17Z", "2026-07-02T16:22:00Z", "2026-07-06T19:53:02Z")).toBe(9);
    expect(deliveryPeriodDays([], null, null, "2026-07-06T19:53:02Z")).toBe(10);
  });
});
