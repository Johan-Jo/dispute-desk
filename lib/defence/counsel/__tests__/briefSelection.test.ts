/**
 * Which brief a non-receipt ledger reaches (2026-09-29).
 *
 * Regression: since the single-writer release every multi-parcel
 * item-not-received ledger (blume-box #360980) fell to the general brief —
 * `within` dropped the parcel claims and required `carrier_delivered`.
 * Gap: a single parcel in transit (Mein Maison #102083) had no ledger at all.
 */
import { describe, expect, it } from "vitest";
import { ledgerForBrief } from "../run";
import { ITEM_NOT_RECEIVED_BRIEF } from "../briefs";
import { buildItemNotReceivedLedger } from "../claimLedger";
import type { EvidenceFact } from "../../types";
import type { LedgerInput } from "../types";

const BUNDLE = {
  carrier: "GOFO",
  deliveredAt: "2026-09-24T19:43:25Z",
  fulfilledAt: null,
  fulfillmentEventAt: "2026-09-15T19:25:25Z",
  items: [{ quantity: 1, title: "The Back to School Bundle" }],
  proofType: "delivered_confirmed",
  reference: "YT2640221437435982",
  referenceIsTrackingNumber: true,
  trackingUrl: "https://www.gofo.com/us/track?searchID=YT2640221437435982",
};
const SUNSCREEN = {
  carrier: "USPS",
  deliveredAt: null,
  fulfilledAt: "2026-09-16T18:53:06Z",
  fulfillmentEventAt: "2026-09-16T18:53:06Z",
  items: [{ quantity: 1, title: "Sunburst Mineral SPF 50 Sunscreen" }],
  proofType: "delivered_unverified",
  reference: "260914OET4",
  referenceIsTrackingNumber: false,
  trackingUrl: null,
};

function input(shipments: object[], opened = "2026-09-19T00:15:40Z"): LedgerInput {
  const value = {
    carrier: "GOFO",
    deliveredAt: BUNDLE.deliveredAt,
    proofType: "delivered_confirmed",
    trackingNumber: BUNDLE.reference,
    trackingUrl: BUNDLE.trackingUrl,
    shipments,
  };
  return {
    moduleKey: "inr_product_not_received",
    facts: [{ id: "f-ship", category: "shipping_tracking", value }] as unknown as EvidenceFact[],
    packSections: [
      {
        type: "order",
        data: {
          orderName: "#360980",
          createdAt: "2026-08-22T16:15:58Z",
          lineItems: [
            { lineItemId: "L-sun", quantity: 1, title: "Sunburst Mineral SPF 50 Sunscreen" },
            { lineItemId: "L-bundle", quantity: 1, title: "The Back to School Bundle" },
          ],
        },
      },
      {
        type: "shipping",
        data: {
          fulfillments: [
            { createdAt: "2026-09-16T18:53:06Z", tracking: [{ number: "260914OET4" }], items: [{ lineItemId: "L-sun", quantity: 1 }] },
            { createdAt: "2026-09-15T19:25:25Z", tracking: [{ number: "YT2640221437435982" }], items: [{ lineItemId: "L-bundle", quantity: 1 }] },
          ],
        },
      },
    ],
    orderName: "#360980",
    disputeOpenedAt: opened,
    disputeAmount: 129,
    disputeCurrency: "USD",
    customerOrders: [],
  };
}


function inTransitInput(proofType = "in_transit"): LedgerInput {
  return {
    moduleKey: "inr_product_not_received",
    facts: [
      { id: "f1", category: "shipping_tracking", value: { proofType, carrier: "YunExpress", trackingNumber: "YT2625700707743098" } },
    ] as unknown as EvidenceFact[],
    packSections: [
      { type: "order", data: { orderName: "#102083", createdAt: "2026-09-10T10:00:00Z", lineItems: [{ lineItemId: "L1", quantity: 2, title: "Lamp" }] } },
      { type: "shipping", data: { fulfillments: [{ createdAt: "2026-09-14T06:11:28Z", tracking: [{ number: "YT2625700707743098" }], items: [{ lineItemId: "L1", quantity: 2 }] }] } },
    ],
    orderName: "#102083",
    disputeOpenedAt: "2026-09-22T04:02:47Z",
    disputeAmount: null,
    disputeCurrency: null,
    customerOrders: [],
  };
}

describe("ledgerForBrief — item not received", () => {
  it("multi-parcel reaches the item-not-received brief and keeps every parcel", () => {
    const r = ledgerForBrief(ITEM_NOT_RECEIVED_BRIEF, input([BUNDLE, SUNSCREEN]), null)!;
    expect(r.brief.type).toBe("item_not_received");
    const ids = r.ledger.map((c) => c.id);
    expect(ids).toContain("some_parcel_delivered");
    expect(ids).toEqual(expect.arrayContaining(["parcel_1", "parcel_2"]));
  });

  it("a single parcel in transit gets its own ledger, not the general brief", () => {
    const r = ledgerForBrief(ITEM_NOT_RECEIVED_BRIEF, inTransitInput(), null)!;
    expect(r.brief.type).toBe("item_not_received");
    const ids = r.ledger.map((c) => c.id);
    expect(ids).toEqual(["claim_is_non_receipt", "shipment_in_transit", "whole_order_in_shipment"]);
    const c = r.ledger.find((x) => x.id === "shipment_in_transit")!;
    expect(c.statement).toMatch(/in transit/);
    expect(c.statement).not.toMatch(/deliver|receiv|\d{4}/i);
    expect(JSON.stringify(r.ledger)).not.toMatch(/September/);
    expect(c.mustNot.join(" ")).toMatch(/contradicts, refutes, disproves/);
  });

  it("no carrier record at all still falls to the general brief", () => {
    const r = ledgerForBrief(ITEM_NOT_RECEIVED_BRIEF, inTransitInput("label_created"), null)!;
    expect(r.brief.type).toBe("general");
    expect(buildItemNotReceivedLedger(inTransitInput("label_created"))).toBeNull();
  });
});
