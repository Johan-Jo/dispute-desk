/**
 * Item-not-received letter, reviewed on blume-box #352543 (2026-09-24):
 * the opening states the carrier record and the dispute date, the money
 * reconciles to the charge, nothing is stated twice, and the letter does not
 * overstate its sources.
 */
import { describe, it, expect } from "vitest";
import { renderThesis } from "../pdf/renderThesis";
import { reconcileToOrderTotal } from "../orderContext";
import { normalizeChronologyText } from "../chronology";
import { singleShipmentOf, deliveryFactIds, lineItemsTotal } from "../render/documentModel";
import { omitDeniedSections, isSectionDeniedForModule } from "../sectionVisibility";
import { sectionTitleFor } from "../render/sections";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import type { DefenceNarrativeOutput, EvidenceFact } from "../types";

const delivery = (value: Record<string, unknown>): EvidenceFact =>
  ({ id: "f-dp", category: "delivery_proof", value, label: "Delivery", strength: "strong" }) as unknown as EvidenceFact;

const stallion = delivery({
  proofType: "delivered_confirmed",
  carrier: "Stallion Express",
  trackingNumber: "260702441A",
  trackingUrl: "https://stallionexpress.ca/track/?tracking=260702441A",
  deliveredAt: "2026-07-06T19:53:02Z",
});

const opening = (facts: EvidenceFact[], disputeOpenedAt: string | null) =>
  renderThesis({
    sectionKey: "executiveSummary",
    familyKey: "item_not_received",
    packageMode: "full",
    approvedFacts: facts,
    caseContext: { orderName: "#352543", disputeOpenedAt },
  });

describe("opening line — the carrier record, then the dispute date", () => {
  it("states carrier, order, delivery date and the later dispute date — the tracking number is on the card only", () => {
    expect(opening([stallion], "2026-09-19T02:33:38Z")).toBe(
      "Stallion Express recorded the shipment for order #352543 as delivered on 6 July 2026; the dispute was opened on 19 September 2026.",
    );
  });

  it("leaves the dispute date out when delivery came after it", () => {
    expect(opening([stallion], "2026-07-01T00:00:00Z")).toBe(
      "Stallion Express recorded the shipment for order #352543 as delivered on 6 July 2026.",
    );
  });

  it("on a multi-parcel order names the delivered parcel as 'a shipment', never the order", () => {
    const multi = delivery({
      proofType: "delivered_confirmed",
      shipments: [
        { carrier: "GOFO", reference: "YT2640221437435982", referenceIsTrackingNumber: true, proofType: "delivered_confirmed", deliveredAt: "2026-09-24T19:43:25Z" },
        { carrier: "USPS", reference: "260914OET4", referenceIsTrackingNumber: false, proofType: "fulfilled" },
      ],
    });
    expect(opening([multi], "2026-09-19T02:33:38Z")).toBe(
      "GOFO recorded a shipment for order #352543 as delivered on 24 September 2026.",
    );
  });

  it("has no opening line without a carrier-confirmed delivery", () => {
    expect(opening([delivery({ proofType: "in_transit", carrier: "GOFO" })], "2026-09-19T02:33:38Z")).toBe("");
  });

  it("the shipping section no longer repeats the opening line", () => {
    expect(
      renderThesis({
        sectionKey: "fulfillmentArgument",
        familyKey: "item_not_received",
        packageMode: "full",
        approvedFacts: [stallion],
        caseContext: { orderName: "#352543", disputeOpenedAt: "2026-09-19T02:33:38Z" },
      }),
    ).toBe("");
  });
});

describe("money — the table reconciles to what the card was charged", () => {
  const items = [
    { price: "CAD 20.39" },
    { price: "CAD 19.13" },
    { price: "CAD 81.50" },
  ];

  it("adds shipping, tax and discount rows when they add up to the order total", () => {
    const rows = reconcileToOrderTotal(items, {
      currency: "CAD", total: "130.02", shipping: "10.00", tax: "4.00", discounts: "5.00",
    });
    expect(rows.map((r) => [r.description, r.price])).toEqual([
      ["Discount", "CAD -5.00"],
      ["Shipping", "CAD 10.00"],
      ["Tax", "CAD 4.00"],
    ]);
    const total = lineItemsTotal([
      ...items.map((it) => ({ description: "x", quantity: 1, price: it.price })),
      ...rows,
    ]);
    expect(total).toEqual({ quantity: 3, amount: "CAD 130.02" });
  });

  it("falls back to one net row when the named amounts do not add up", () => {
    const rows = reconcileToOrderTotal(items, { currency: "CAD", total: "120.75", shipping: "3.00" });
    expect(rows).toEqual([
      { description: "Shipping, tax and adjustments", quantity: 0, price: "CAD -0.27", kind: "adjustment" },
    ]);
  });

  it("adds nothing when the currencies differ", () => {
    expect(reconcileToOrderTotal([{ price: "USD 102.36" }], { currency: "CAD", total: "120.75" })).toEqual([]);
  });

  it("drops Shopify's chargeback fee from the chargeback line", () => {
    expect(normalizeChronologyText("The customer opened a chargeback totaling $120.75 CAD + $15.00 USD.")).toBe(
      "The customer opened a chargeback totaling $120.75 CAD.",
    );
  });
});

describe("attribution — one carrier record, stated once and not overstated", () => {
  it("rewrites the old 'to the recipient' line to what the record holds", () => {
    expect(normalizeChronologyText("Carrier confirmed delivery of the shipment to the recipient.")).toBe(
      "Carrier recorded the shipment as delivered.",
    );
  });

  const banned = (text: string) => (item_not_received.prohibitedBankPhrases ?? []).some((re) => re.test(text));

  it("bans records said to corroborate each other independently", () => {
    expect(banned("each independently corroborating the same delivery date and time")).toBe(true);
    expect(banned("which the issuer can independently verify")).toBe(false);
  });

  it("bans characterising who initiated the transaction", () => {
    expect(banned("consistent with a cardholder-initiated transaction under Visa 13.1")).toBe(true);
  });
});

describe("structure — no restating sections, the record as a card", () => {
  it("drops the transaction overview and the chronology paragraph for item not received", () => {
    expect(isSectionDeniedForModule("transactionOverviewArgument", "inr_product_not_received")).toBe(true);
    expect(isSectionDeniedForModule("chronologyArgument", "inr_product_not_received")).toBe(true);
    expect(isSectionDeniedForModule("fulfillmentArgument", "inr_product_not_received")).toBe(false);

    const narrative = {
      executiveSummary: { text: "s", usedFactIds: [] },
      transactionOverviewArgument: { text: "restates", usedFactIds: ["f"] },
      chronologyArgument: { text: "consistent with a cardholder-initiated transaction", usedFactIds: [] },
      paymentAuthenticationArgument: { text: "", usedFactIds: [] },
      fulfillmentArgument: { text: "f", usedFactIds: [] },
      communicationArgument: { text: "", usedFactIds: [] },
      policyArgument: { text: "", usedFactIds: [] },
      manualEvidenceArgument: { text: "", usedFactIds: [] },
      conclusion: { text: "c", usedFactIds: [] },
      omittedSections: [],
      warnings: [],
    } as DefenceNarrativeOutput;
    const out = omitDeniedSections(narrative, "inr_product_not_received");
    expect(out.transactionOverviewArgument.text).toBe("");
    expect(out.chronologyArgument.text).toBe("");
    expect(out.omittedSections.map((o) => o.sectionKey).sort()).toEqual(["chronologyArgument", "transactionOverviewArgument"]);
  });

  it("builds the single-parcel card from the record, labelled with the order", () => {
    const events = [{ at: "2026-07-02T16:22:00Z", text: "Stallion marked 3 items as fulfilled from Canada." }];
    const s = singleShipmentOf([stallion], events, "#352543");
    expect(s).toMatchObject({
      carrier: "Stallion Express",
      reference: "260702441A",
      referenceIsTrackingNumber: true,
      proofType: "delivered_confirmed",
      deliveredAt: "2026-07-06T19:53:02Z",
      fulfillmentEventAt: "2026-07-02T16:22:00Z",
      items: [{ title: "Order #352543", quantity: 1 }],
    });
    expect([...deliveryFactIds([stallion])]).toEqual(["f-dp"]);
    expect(singleShipmentOf([delivery({ proofType: "fulfilled", carrier: "USPS" })], events, "#1")).toBeNull();
  });

  it("titles the section 'Shipping & Delivery' for goods", () => {
    expect(sectionTitleFor("fulfillmentArgument", [stallion])).toBe("Shipping & Delivery");
  });
});
