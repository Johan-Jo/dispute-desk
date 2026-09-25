/**
 * Single-parcel item-not-received letters with a carrier-confirmed delivery
 * are written from the records (blume-box #352543, 2026-09-24): every part of
 * the document states something no other part states.
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
  timelineEvents: [{ at: "2026-07-02T16:22:00Z", text: "Stallion marked 3 items as fulfilled from Canada." }],
};

describe("single-parcel non-receipt letters are written from the records", () => {
  const out = applyShipmentRecordSections(modelDraft(), facts, ctx);

  it("summary: the argument, not the facts the opening line states", () => {
    expect(out.executiveSummary.text).toBe(
      "The carrier's delivery record contradicts the claim that the item was not received.",
    );
  });

  it("shipping prose: only the tracking link — the card carries everything else", () => {
    expect(out.fulfillmentArgument.text).toBe(
      "Stallion Express's tracking record for this shipment is available at https://stallionexpress.ca/track/?tracking=260702441A.",
    );
  });

  it("conclusion: the request line alone, listed as omitted so the validator agrees", () => {
    expect(out.conclusion.text).toBe("");
    expect(out.omittedSections.map((o) => o.sectionKey)).toEqual(
      expect.arrayContaining(["transactionOverviewArgument", "chronologyArgument", "conclusion"]),
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
    expect(conclusion?.llmText).toBe("");
  });

  it("the tracking number is printed by no prose section — only the card has it", () => {
    for (const k of ["executiveSummary", "conclusion"] as const) {
      expect(out[k].text).not.toContain("260702441A");
    }
    // The link text in the shipping prose is the one place the URL appears.
    expect(out.fulfillmentArgument.text.match(/260702441A/g)).toHaveLength(1);
  });

  it("keeps the model's other sections", () => {
    expect(out.policyArgument.text).toBe("Policy text.");
  });

  it("'answers' rather than 'contradicts' when the delivery came after the dispute opened", () => {
    const later = applyShipmentRecordSections(modelDraft(), facts, { ...ctx, disputeOpenedAt: "2026-07-01T00:00:00Z" });
    expect(later.executiveSummary.text).toBe(
      "The carrier's delivery record answers the claim that the item was not received.",
    );
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
