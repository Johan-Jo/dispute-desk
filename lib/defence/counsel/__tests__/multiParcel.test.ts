/**
 * Multi-parcel item-not-received letters, from blume-box #360980's records
 * (two parcels: the Bundle carrier-delivered by GOFO on 24 Sep, after the
 * dispute opened on 19 Sep; the sunscreen shipped by the merchant under a
 * USPS shipping reference with no carrier record).
 */
import { describe, expect, it } from "vitest";
import { buildItemNotReceivedLedger } from "../claimLedger";
import { checkDraft, type CheckContext } from "../checks";
import { composeDraft } from "../generate";
import { ITEM_NOT_RECEIVED } from "../playbooks";
import { timelineBlock } from "../prompts";
import { buildRecordSections, pickTheory } from "../recordSections";
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

const check = (i: LedgerInput, ledger: NonNullable<ReturnType<typeof buildItemNotReceivedLedger>>): CheckContext => ({
  ledger,
  playbook: ITEM_NOT_RECEIVED,
  facts: i.facts,
  disputeOpenedAt: i.disputeOpenedAt,
  merchantName: "Blume",
  carrierName: "GOFO",
  carrierNames: ["GOFO", "USPS"],
  productNames: ["The Back to School Bundle", "Sunburst Mineral SPF 50 Sunscreen"],
  pageIdentifiers: ["#360980", "360980", "YT2640221437435982", "260914OET4", "129"],
  trackingUrl: BUNDLE.trackingUrl,
});

const PARTIAL_SUMMARY =
  "The cardholder says the order was never received. The carrier recorded delivery of the parcel with The Back to School Bundle on 24 September 2026. " +
  "The merchant shipped the Sunburst Mineral SPF 50 Sunscreen in the second parcel. " +
  "The non-receipt claim is not supported by the carrier's delivery record. The merchant requests that the chargeback be reversed.";

describe("multi-parcel counsel ledger (#360980)", () => {
  it("states each parcel from its own record, and no timing against the dispute", () => {
    const ledger = buildItemNotReceivedLedger(input([BUNDLE, SUNSCREEN]))!;
    expect(ledger.map((c) => c.id)).toEqual([
      "claim_is_non_receipt",
      "order_in_parcels",
      "parcel_1",
      "parcel_2",
      "some_parcel_delivered",
      "carrier_is_third_party",
    ]);
    const byId = new Map(ledger.map((c) => [c.id, c]));
    expect(byId.get("order_in_parcels")!.specifics.allItemsInParcels).toBe("yes");
    expect(byId.get("parcel_1")!.statement).toBe(
      "The carrier recorded the parcel with The Back to School Bundle as delivered on 24 September 2026.",
    );
    expect(byId.get("parcel_2")!.statement).toBe("The merchant shipped the parcel with Sunburst Mineral SPF 50 Sunscreen.");
    // Delivered after the dispute opened, and one parcel undelivered: no
    // dispute-timing claim and no later-order argument.
    expect(byId.has("dispute_after_delivery")).toBe(false);
    expect(byId.has("later_order")).toBe(false);
    expect(JSON.stringify(ledger)).not.toMatch(/15 September|16 September|22 August/);
  });

  it("picks the partial-delivery theory, and the summary must carry every parcel", () => {
    const ledger = buildItemNotReceivedLedger(input([BUNDLE, SUNSCREEN]))!;
    const t = pickTheory(ledger, ITEM_NOT_RECEIVED);
    expect(t.name).toBe("delivered_parcel_and_rest_shipped");
    expect(t.claims).toEqual(["some_parcel_delivered", "order_in_parcels", "parcel_1", "parcel_2"]);
  });

  it("writes Shipping and the conclusion from the records, without claiming the unrecorded parcel", () => {
    const ledger = buildItemNotReceivedLedger(input([BUNDLE, SUNSCREEN]))!;
    const r = buildRecordSections(ledger);
    expect(r.evidenceSections.map((s) => s.key)).toEqual(["shipping"]);
    expect(r.evidenceSections[0].paragraphs[0]).toBe(
      "The order was sent in two parcels, shown on the cards above, and every item listed under Order Line Items was in one of them. " +
        "The parcel with The Back to School Bundle is recorded as delivered by the carrier's own scan, which the issuer can open with the link on its card. " +
        "The merchant shipped the parcel with Sunburst Mineral SPF 50 Sunscreen.",
    );
    expect(r.conclusion.paragraphs[0]).toBe(
      "The carrier recorded delivery of the parcel with The Back to School Bundle, so the non-receipt claim is not supported for those goods. " +
        "The merchant shipped the parcel with Sunburst Mineral SPF 50 Sunscreen.",
    );
  });

  it("passes every code check and the production validator with a partial-delivery summary", () => {
    const i = input([BUNDLE, SUNSCREEN]);
    const ledger = buildItemNotReceivedLedger(i)!;
    const draft = composeDraft({ paragraphs: [PARTIAL_SUMMARY], claimIds: [] }, buildRecordSections(ledger));
    expect(checkDraft(draft, check(i, ledger))).toEqual([]);
  });

  it("refuses 'the complete order', a carrier's name and a delivery date for the shipped parcel", () => {
    const i = input([BUNDLE, SUNSCREEN]);
    const ledger = buildItemNotReceivedLedger(i)!;
    const bad = PARTIAL_SUMMARY.replace("the parcel with The Back to School Bundle", "the complete order via USPS").replace(
      "in the second parcel",
      "in the second parcel on 16 September 2026",
    );
    const issues = checkDraft(composeDraft({ paragraphs: [bad], claimIds: [] }, buildRecordSections(ledger)), check(i, ledger));
    expect(issues.join("\n")).toMatch(/complete order/);
    expect(issues.join("\n")).toMatch(/"USPS" appears/);
    expect(issues.join("\n")).toMatch(/"16 September" is not a specific/);
  });

  it("gives the reviewer each parcel's state", () => {
    expect(timelineBlock(buildItemNotReceivedLedger(input([BUNDLE, SUNSCREEN]))!)).toBe(
      [
        "- Parcel with The Back to School Bundle: carrier recorded delivery on 24 September 2026.",
        "- Parcel with Sunburst Mineral SPF 50 Sunscreen: shipped by the merchant (no carrier record of delivery)."
      ].join("\n"),
    );
  });

  it("argues the whole order, and the dispute timing, when every parcel was delivered before the dispute", () => {
    const both = [BUNDLE, { ...SUNSCREEN, proofType: "delivered_confirmed", deliveredAt: "2026-09-18T10:00:00Z", referenceIsTrackingNumber: true, trackingUrl: "https://x.example/t" }];
    const ledger = buildItemNotReceivedLedger(input(both, "2026-09-30T00:00:00Z"))!;
    const ids = ledger.map((c) => c.id);
    expect(ids).toContain("all_parcels_delivered");
    expect(ids).toContain("dispute_after_delivery");
    expect(pickTheory(ledger, ITEM_NOT_RECEIVED).name).toBe("every_parcel_delivered");
    const r = buildRecordSections(ledger);
    expect(r.evidenceSections[0].paragraphs[0]).toContain(
      "The carrier recorded each parcel as delivered; each delivery is the carrier's own scan, published on its public tracking page, which the issuer can open with the link on the parcel's card.",
    );
    expect(r.conclusion.paragraphs[0]).toBe("The carrier recorded delivery of every parcel in the order. The non-receipt claim is not supported by the record.");
  });

  it("has no counsel letter when no parcel has a carrier-confirmed delivery", () => {
    expect(buildItemNotReceivedLedger(input([{ ...BUNDLE, proofType: "in_transit", deliveredAt: null }, SUNSCREEN]))).toBeNull();
  });
});
