/**
 * The ledger offers shipping/transit timing only when it helps the merchant.
 * Mein Maison #100463 (2026-09-29): "The carrier recorded delivery
 * twenty-six days after the merchant shipped the order" reached a PayPal
 * letter because `transit_days` was offered unconditionally.
 */
import { describe, expect, it } from "vitest";
import { buildItemNotReceivedLedger } from "../claimLedger";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

function input(o: { ordered: string; shipped: string; delivered: string; policy?: string }): LedgerInput {
  const facts = [
    {
      id: "f1",
      category: "delivery_proof",
      value: { proofType: "delivered_confirmed", carrier: "Northwind Post", trackingNumber: "T1", deliveredAt: o.delivered },
    },
  ] as unknown as EvidenceFact[];
  return {
    moduleKey: "inr_product_not_received",
    facts,
    packSections: [
      { type: "order", data: { orderName: "#1", createdAt: o.ordered } },
      { type: "shipping", data: { fulfillments: [{ createdAt: o.shipped, tracking: [{ number: "T1" }] }] } },
      ...(o.policy ? [{ type: "shipping_policy", data: { policies: [{ textPreview: o.policy }] } }] : []),
    ],
    orderName: "#1",
    disputeOpenedAt: "2026-10-05T00:00:00Z",
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [],
  };
}
const ids = (i: LedgerInput) => buildItemNotReceivedLedger(i)!.map((c) => c.id);

describe("timing claims are offered only when they help", () => {
  it("#100463 shape: shipped next day, delivered 26 days later → no transit claim", () => {
    const got = ids(input({ ordered: "2026-09-01T10:00:00Z", shipped: "2026-09-02T10:00:00Z", delivered: "2026-09-28T10:00:00Z" }));
    expect(got).not.toContain("transit_days");
    expect(got).toContain("shipped_promptly");
    expect(got).toContain("carrier_delivered");
  });

  it("slow dispatch with no published window → no shipping claim either", () => {
    const got = ids(input({ ordered: "2026-09-01T10:00:00Z", shipped: "2026-09-11T10:00:00Z", delivered: "2026-09-28T10:00:00Z" }));
    expect(got).not.toContain("shipped_promptly");
    expect(got).not.toContain("transit_days");
  });

  it("dispatch inside the published window is cited", () => {
    const got = ids(
      input({
        ordered: "2026-09-01T10:00:00Z", // Tue
        shipped: "2026-09-04T10:00:00Z", // Fri: 3 business days
        delivered: "2026-09-08T10:00:00Z",
        policy: "Orders ship within 1-3 business days.",
      }),
    );
    expect(got).toContain("shipped_promptly");
    expect(got).toContain("within_shipping_policy");
  });

  it("a delivery inside the merchant's period keeps the transit claim", () => {
    const got = ids(input({ ordered: "2026-09-01T10:00:00Z", shipped: "2026-09-01T18:00:00Z", delivered: "2026-09-05T10:00:00Z" }));
    expect(got).toContain("shipped_promptly");
    expect(got).toContain("transit_days");
  });

  it("a published delivery window decides the transit claim", () => {
    const slowButPromised = input({
      ordered: "2026-09-01T10:00:00Z",
      shipped: "2026-09-02T10:00:00Z",
      delivered: "2026-09-15T10:00:00Z",
      policy: "Orders are delivered within 21 days.",
    });
    expect(ids(slowButPromised)).toContain("transit_days");
  });
});
