/**
 * Single-parcel item-not-received letters with a carrier-confirmed delivery
 * are written from the records (blume-box #352543, 2026-09-24/25): each part has
 * its own job, and the shipping section argues the chain the records form.
 */
import { describe, it, expect } from "vitest";
import { applyShipmentRecordSections } from "../shipmentRecordSections";
import { validateNarrative } from "../validateNarrative";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { deliveryPostDatesDispute, NO_INTERNAL_CONSTRAINTS } from "../internalConstraints";
import { composePdfBlocks } from "../pdf/composePdfBlocks";
import type { DefenceNarrativeOutput, EvidenceFact } from "../types";

const facts = [
  {
    id: "f-dp",
    category: "delivery_proof",
    label: "Delivery",
    strength: "strong",
    value: {
      proofType: "delivered_confirmed",
      carrier: "Stallion Express",
      trackingNumber: "260702441A",
      trackingUrl: "https://stallionexpress.ca/track/?tracking=260702441A",
      deliveredAt: "2026-07-06T19:53:02Z",
    },
  },
] as unknown as EvidenceFact[];

function modelDraft(): DefenceNarrativeOutput {
  const s = (text: string) => ({ text, usedFactIds: ["f-dp"] });
  return {
    executiveSummary: s("The merchant contests this claim. Stallion Express confirmed delivery on 6 July 2026 (tracking 260702441A)."),
    transactionOverviewArgument: s(""),
    chronologyArgument: s(""),
    paymentAuthenticationArgument: s(""),
    fulfillmentArgument: s("The carrier's delivery confirmation is consistent with successful completion of the merchant's shipping obligation."),
    communicationArgument: s(""),
    policyArgument: s("Policy text."),
    manualEvidenceArgument: s(""),
    conclusion: s("The merchant respectfully requests that the issuer reverse this chargeback. Tracking 260702441A."),
    omittedSections: [
      { sectionKey: "paymentAuthenticationArgument", reason: "n/a" },
      { sectionKey: "communicationArgument", reason: "n/a" },
      { sectionKey: "manualEvidenceArgument", reason: "n/a" },
    ],
    warnings: [],
  };
}

const ctx = {
  moduleKey: "inr_product_not_received",
  orderName: "#352543",
  disputeOpenedAt: "2026-09-19T02:33:38Z",
  timelineEvents: [
    { at: "2026-07-02T05:33:17Z", text: "Victoria Froebe placed this order on Online Store (checkout #44522904158401)." },
    { at: "2026-07-02T16:22:00Z", text: "Stallion marked 3 items as fulfilled from Canada." },
    { at: "2026-07-02T16:22:05Z", text: "Stallion sent a shipping confirmation email to Victoria Froebe (v@example.com)." },
    { at: "2026-07-06T19:53:10Z", text: "Stallion sent a shipment delivered email to Victoria Froebe (v@example.com)." },
  ],
  lineItems: [
    { description: "Superbalm Tripeptide-1 Lip Tint in Wild Plum", quantity: 1, price: "CAD 24.50" },
    { description: "Blume Buds Power Patches for Acne", quantity: 1, price: "CAD 23.00" },
    { description: "Clear Skin Kit: Acne Essentials", quantity: 1, price: "CAD 98.00" },
    { description: "Discount", quantity: 0, price: "CAD -47.50", kind: "adjustment" as const },
    { description: "Shipping", quantity: 0, price: "CAD 10.00", kind: "adjustment" as const },
    { description: "Tax", quantity: 0, price: "CAD 12.75", kind: "adjustment" as const },
  ],
  disputeAmount: 120.75,
  disputeCurrency: "CAD",
};

describe("single-parcel non-receipt letters argue the chain the records form", () => {
  const out = applyShipmentRecordSections(modelDraft(), facts, ctx);

  it("summary: the position and what the defence rests on", () => {
    expect(out.executiveSummary.text).toBe(
      "The merchant contests the CAD 120.75 non-receipt chargeback in full. The defence rests on the chain of records set out below: the order identifies what was purchased, the fulfilment record ties those items to the Stallion Express shipment, and the carrier's record shows that shipment as delivered.",
    );
  });

  it("shipping: order → shipment → delivery, timing, money, notices, link", () => {
    expect(out.fulfillmentArgument.text.split(/\n\n/)).toEqual([
      "The merchant's fulfilment record for order #352543 records all three purchased items as shipped together on 2 July 2026 under Stallion Express tracking number 260702441A. Stallion Express then recorded that shipment as delivered on 6 July 2026 at 19:53 UTC. This is the carrier's own record, not the merchant's: it shows that the shipment carrying the disputed purchase reached delivered status.",
      "The delivery was recorded on 6 July, and the dispute was opened on 19 September 2026: the record relied on here was made before the claim, not in response to it.",
      "The three items total CAD 145.50; less the CAD 47.50 discount, plus CAD 10.00 shipping and CAD 12.75 tax, the order comes to CAD 120.75, the full disputed amount. The shipment therefore accounts for the whole of the disputed purchase.",
      "The order history also records a shipping confirmation email on 2 July and a delivery notification on 6 July, sent to the customer. They show the customer was kept informed; the delivery itself rests on the carrier's record.",
      "Stallion Express's tracking record for this shipment is available at https://stallionexpress.ca/track/?tracking=260702441A.",
    ]);
  });

  it("conclusion: what the request rests on, with the amount — under the fixed request line", () => {
    expect(out.conclusion.text).toBe(
      "The records connect the full CAD 120.75 purchase to a shipment that Stallion Express recorded as delivered before the dispute was opened.",
    );
    const blocks = composePdfBlocks({
      narrative: out,
      approvedFacts: facts,
      packageMode: "full",
      familyKey: "item_not_received",
      moduleKey: "inr_product_not_received",
      fulfillmentStatus: "FULFILLED",
      caseContext: { orderName: "#352543", disputeOpenedAt: ctx.disputeOpenedAt },
    });
    const conclusion = blocks.find((b) => b.sectionKey === "conclusion");
    expect(conclusion?.thesisText).toBe("Based on the evidence above, the merchant respectfully requests reversal of the chargeback.");
  });

  it("states each fact where it is argued — the tracking number once in prose, plus the link", () => {
    const prose = [out.executiveSummary.text, out.fulfillmentArgument.text, out.conclusion.text].join(" ");
    expect(prose.match(/260702441A/g)).toHaveLength(2);
    expect(prose).not.toMatch(/independent/i);
  });

  it("drops the item claim and the money line when the records do not carry them", () => {
    const partial = applyShipmentRecordSections(modelDraft(), facts, {
      ...ctx,
      timelineEvents: [{ at: "2026-07-02T16:22:00Z", text: "Stallion marked 2 items as fulfilled from Canada." }],
      disputeAmount: 50,
    });
    expect(partial.fulfillmentArgument.text).toContain("records the order as shipped on 2 July 2026");
    expect(partial.fulfillmentArgument.text).not.toContain("full disputed amount");
    expect(partial.fulfillmentArgument.text).not.toContain("confirmation email");
    expect(partial.executiveSummary.text).toContain("ties the order to the Stallion Express shipment");
  });

  it("keeps the model's other sections", () => {
    expect(out.policyArgument.text).toBe("Policy text.");
  });

  it("says nothing about timing when the delivery came after the dispute opened", () => {
    const later = applyShipmentRecordSections(modelDraft(), facts, { ...ctx, disputeOpenedAt: "2026-07-01T00:00:00Z" });
    expect(later.fulfillmentArgument.text).not.toContain("before the claim");
    expect(later.conclusion.text).not.toContain("before the dispute");
  });

  it("leaves other families and non-delivered records to the model", () => {
    const draft = modelDraft();
    expect(applyShipmentRecordSections(draft, facts, { ...ctx, moduleKey: "visa_10_4_fraud" })).toBe(draft);
    const inTransit = [{ ...facts[0], value: { ...(facts[0].value as object), proofType: "in_transit" } }] as EvidenceFact[];
    expect(applyShipmentRecordSections(draft, inTransit, ctx)).toBe(draft);
  });

  it("passes the full validator with the INR family", () => {
    const res = validateNarrative({
      narrative: out,
      approvedFacts: facts,
      reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED"),
      packageMode: "full",
      internalOnlyFactIds: [],
      extraHardPhrases: item_not_received.prohibitedBankPhrases,
      guardedPhrases: item_not_received.guardedBankPhrases,
      internalConstraints: {
        ...NO_INTERNAL_CONSTRAINTS,
        deliveryPostDatesDispute: deliveryPostDatesDispute(facts, ctx.disputeOpenedAt),
      },
    });
    expect(res.errors).toEqual([]);
  });
});
