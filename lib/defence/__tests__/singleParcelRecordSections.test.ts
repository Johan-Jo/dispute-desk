/**
 * Single-parcel item-not-received letters with a carrier-confirmed delivery
 * are written from the records (blume-box #352543, reviewed 2026-09-24/25):
 * each section carries its own part of the argument — the claim is
 * non-receipt, the linked shipment has a carrier-recorded delivery, the
 * fulfilment mapping puts every item in it, so the delivery evidence covers
 * the complete disputed purchase — and every link is conditional on the
 * record that makes it.
 */
import { describe, it, expect } from "vitest";
import { applyShipmentRecordSections } from "../shipmentRecordSections";
import { fulfilmentCoverage } from "../fulfilmentCoverage";
import { validateNarrative } from "../validateNarrative";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { deliveryPostDatesDispute, NO_INTERNAL_CONSTRAINTS } from "../internalConstraints";
import { omitDeniedSections } from "../sectionVisibility";
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
    transactionOverviewArgument: s("The transaction restated."),
    chronologyArgument: s("The chronology restated."),
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

const ids = ["gid://shopify/LineItem/1", "gid://shopify/LineItem/2", "gid://shopify/LineItem/3"];
const packSections = [
  {
    type: "order",
    data: { lineItems: ids.map((lineItemId) => ({ lineItemId, quantity: 1 })) },
  },
  {
    type: "shipping",
    data: {
      fulfillments: [
        {
          createdAt: "2026-07-02T16:22:00Z",
          tracking: [{ number: "260702441A" }],
          items: ids.map((lineItemId) => ({ lineItemId, quantity: 1 })),
        },
      ],
    },
  },
];

const ctx = {
  moduleKey: "inr_product_not_received",
  orderName: "#352543",
  disputeOpenedAt: "2026-09-19T02:33:38Z",
  timelineEvents: [
    { at: "2026-07-02T05:33:17Z", text: "Victoria Froebe placed this order on Online Store (checkout #44522904158401)." },
    { at: "2026-07-02T05:33:18Z", text: "A $120.75 CAD payment was processed using a Visa ending in 3627 via Apple Pay." },
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
  customerEmail: "V@example.com",
  packSections,
};

/** As the job runs it: the family deny list first, then the records. */
const build = (c: typeof ctx | Record<string, unknown> = ctx) =>
  applyShipmentRecordSections(
    omitDeniedSections(modelDraft(), "inr_product_not_received"),
    facts,
    c as typeof ctx,
  );

describe("fulfilment coverage — item by item, never by count", () => {
  it("verified when the tracked fulfilment maps to every line item in the quantity ordered", () => {
    expect(fulfilmentCoverage(packSections, "260702441A")).toEqual({
      kind: "verified",
      itemCount: 3,
      at: "2026-07-02T16:22:00Z",
    });
  });

  it("a matching count of the wrong items is not verified — the history line is quoted instead", () => {
    const wrong = [
      packSections[0],
      {
        type: "shipping",
        data: {
          fulfillments: [
            {
              tracking: [{ number: "260702441A" }],
              items: [{ lineItemId: ids[0], quantity: 3 }],
            },
          ],
        },
      },
    ];
    expect(fulfilmentCoverage(wrong, "260702441A", ctx.timelineEvents)).toEqual({
      kind: "history",
      actor: "Stallion",
      markedCount: 3,
      at: "2026-07-02T16:22:00Z",
    });
  });

  it("not verified without line-item IDs (packs built before they were collected)", () => {
    const old = [
      { type: "order", data: { lineItems: [{ quantity: 1 }] } },
      { type: "shipping", data: { fulfillments: [{ tracking: [{ number: "260702441A" }], items: [{ quantity: 1 }] }] } },
    ];
    expect(fulfilmentCoverage(old, "260702441A")).toBeNull();
  });

  it("not verified when the tracking number belongs to another fulfilment", () => {
    expect(fulfilmentCoverage(packSections, "OTHER")).toBeNull();
  });
});

describe("single-parcel non-receipt letters argue the case from the records", () => {
  const out = build();

  it("summary: the position, the amount and the chain the case rests on", () => {
    expect(out.executiveSummary.text).toBe(
      "The merchant contests this non-receipt chargeback. Linked order, fulfilment and carrier records connect the purchased goods to the tracked shipment and its delivery event, an affirmative basis to contest the claim in full.",
    );
  });

  it("shipping: order → shipment → carrier delivery, and why the carrier's record answers non-receipt", () => {
    expect(out.fulfillmentArgument.text.split(/\n\n/)).toEqual([
      "The fulfilment record places all three purchased items in the single shipment shown above, and the carrier then recorded that shipment as delivered.",
      "This distinction matters. The merchant does not rely only on its own record that the order was dispatched: the carrier's record reports the delivery itself, which is the event a non-receipt claim puts in issue.",
      "Carrier tracking record: https://stallionexpress.ca/track/?tracking=260702441A",
    ]);
  });

  it("line items: only what the table cannot show — the shipment covers the complete order; no numbers restated", () => {
    expect(out.transactionOverviewArgument.source).toBe("record");
    expect(out.transactionOverviewArgument.text).toBe(
      "The fulfilment record accounts for each product above, in the quantity ordered, within that one shipment. The delivery evidence therefore covers the complete order, not one item or a partial shipment.",
    );
    expect(out.transactionOverviewArgument.text).not.toMatch(/CAD|\d+\.\d{2}/);
  });

  it("chronology: the reported delivery date against the dispute, and the emails as updates sent", () => {
    expect(out.chronologyArgument.source).toBe("record");
    expect(out.chronologyArgument.text.split(/\n\n/)).toEqual([
      "As the timeline below shows, the carrier-recorded delivery is dated before the dispute was opened.",
      "The order history also records shipping and delivery notifications sent to the customer's recorded email address. These document the updates sent; the evidence of delivery remains the carrier's record.",
    ]);
  });

  it("conclusion: the reasoning — the request line with the amount follows it", () => {
    expect(out.conclusion.text).toBe(
      "The order and fulfilment records place the disputed goods in the tracked shipment, and the carrier records that shipment as delivered. These records support the merchant's position that the complete purchase was delivered.",
    );
    const blocks = composePdfBlocks({
      narrative: out,
      approvedFacts: facts,
      packageMode: "full",
      familyKey: "item_not_received",
      moduleKey: "inr_product_not_received",
      fulfillmentStatus: "FULFILLED",
      caseContext: { orderName: "#352543", disputeOpenedAt: ctx.disputeOpenedAt, disputedAmount: "CAD 120.75" },
    });
    const conclusion = blocks.find((b) => b.sectionKey === "conclusion");
    expect(conclusion?.thesisText).toBe("The merchant respectfully requests reversal of the CAD 120.75 chargeback.");
    // Record-built sections pass the family deny list; no filler thesis.
    const overview = blocks.find((b) => b.sectionKey === "transactionOverviewArgument");
    expect(overview?.recordBuilt).toBe(true);
    expect(overview?.thesisText).toBe("");
    const chronology = blocks.find((b) => b.sectionKey === "chronologyArgument");
    expect(chronology?.thesisText).toBe("");
  });

  it("the model's deny-listed restatements never survive", () => {
    const prose = Object.values(out)
      .filter((v): v is { text: string } => !!v && typeof v === "object" && "text" in v)
      .map((v) => v.text)
      .join(" ");
    expect(prose).not.toContain("restated");
    expect(prose).not.toMatch(/independent/i);
    expect(prose).not.toMatch(/successful completion/i);
  });

  it("COPY RULE: each fact once — no order number, tracking number, timestamp or carrier name in the prose", () => {
    // The header carries the order number; the opening line the carrier; the
    // card the tracking number and times; the table total the amount.
    const prose = [
      out.executiveSummary.text,
      out.fulfillmentArgument.text.replace(/https:\/\/\S+/g, ""),
      out.transactionOverviewArgument.text,
      out.chronologyArgument.text,
      out.conclusion.text,
    ].join(" ");
    expect(prose).not.toContain("352543");
    expect(prose).not.toContain("260702441A");
    expect(prose).not.toMatch(/\b\d{1,2}:\d{2}\b/);
    expect(prose).not.toContain("Stallion Express");
    // No amount in the prose: the header, cards and request line carry it.
    expect(prose).not.toContain("120.75");
  });

  it("keeps the model's other sections", () => {
    expect(out.policyArgument.text).toBe("Policy text.");
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

describe("every link is conditional on its record", () => {
  it("history count only: quotes the history, claims no item-by-item match", () => {
    const out = build({ ...ctx, packSections: undefined });
    expect(out.fulfillmentArgument.text).toContain(
      "The order history records Stallion marking 3 items as fulfilled in the shipment shown above, and the carrier then recorded that shipment as delivered.",
    );
    const all = [out.executiveSummary.text, out.fulfillmentArgument.text, out.transactionOverviewArgument.text, out.conclusion.text].join(" ");
    expect(all).not.toMatch(/all three|complete order|each product|disputed goods|in full/);
    // Nothing under the table without a verified mapping.
    expect(out.transactionOverviewArgument.text).toBe("");
    expect(out.omittedSections.map((o) => o.sectionKey)).toContain("transactionOverviewArgument");
  });

  it("emails to another address are 'sent to the customer', not the recorded address", () => {
    const out = build({ ...ctx, customerEmail: "someone@else.com" });
    expect(out.chronologyArgument.text).toContain("notifications sent to the customer.");
  });

  it("no timing argument when the delivery is dated after the dispute", () => {
    const out = build({ ...ctx, disputeOpenedAt: "2026-07-01T00:00:00Z" });
    expect(out.chronologyArgument.text).not.toContain("dated before the dispute");
    expect(out.conclusion.text).not.toContain("before the dispute");
  });

  it("leaves other families and non-delivered records to the model", () => {
    const draft = modelDraft();
    expect(applyShipmentRecordSections(draft, facts, { ...ctx, moduleKey: "visa_10_4_fraud" })).toBe(draft);
    const inTransit = [{ ...facts[0], value: { ...(facts[0].value as object), proofType: "in_transit" } }] as EvidenceFact[];
    expect(applyShipmentRecordSections(draft, inTransit, ctx)).toBe(draft);
  });
});
