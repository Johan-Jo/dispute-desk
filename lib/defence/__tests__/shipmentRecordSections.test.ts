/**
 * Multi-parcel item-not-received letters are written from the records
 * (lib/defence/shipmentRecordSections.ts). Pinned to blume-box #360980's live
 * pack (2026-09-23) and run through the full validator.
 */

import { describe, it, expect } from "vitest";
import { classifyFacts, type ClassifyFactsInput } from "../factClassifier";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { validateNarrative } from "../validateNarrative";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { carrierPossessionUndated, NO_INTERNAL_CONSTRAINTS } from "../internalConstraints";
import { applyShipmentRecordSections } from "../shipmentRecordSections";
import type { DefenceNarrativeOutput } from "../types";

const SUNSCREEN = {
  items: [{ title: "Sunburst Mineral SPF 50 Sunscreen", quantity: 1 }],
  status: "SUCCESS",
  tracking: [{ url: "https://tools.usps.com/go/TrackConfirmAction_input?qtc_tLabels1=260914OET4", number: "260914OET4", carrier: "USPS" }],
  createdAt: "2026-09-16T18:53:06Z",
  deliveredAt: null,
  displayStatus: "FULFILLED",
  fulfillmentId: "gid://shopify/Fulfillment/6721366556865",
  shipmentProofType: "delivered_unverified",
  carrierStatusObservedAt: "2026-09-23T16:44:50.439Z",
};
const BUNDLE = {
  items: [{ title: "The Back to School Bundle", quantity: 1 }],
  status: "SUCCESS",
  tracking: [{ url: "https://www.gofo.com/us/track?searchID=YT2640221437435982", number: "YT2640221437435982", carrier: "GOFO" }],
  createdAt: "2026-09-15T19:25:25Z",
  deliveredAt: null,
  displayStatus: "IN_TRANSIT",
  fulfillmentId: "gid://shopify/Fulfillment/6719323799745",
  shipmentProofType: "in_transit",
  carrierStatusObservedAt: "2026-09-23T16:44:50.439Z",
  inTransitSince: "2026-09-17T03:48:42Z",
};

const module_ = resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED");

function classify(fulfillments: unknown[]) {
  const input: ClassifyFactsInput = {
    packageId: "pkg0",
    sections: [
      {
        type: "shipping",
        label: "Fulfillments",
        source: "shopify_fulfillments",
        fieldsProvided: ["shipping_tracking", "delivery_proof"],
        data: { proofType: "delivered_unverified", deliveredAt: null, fulfillments },
      },
    ],
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "weak",
    manualRows: [],
    reasonCodeModule: module_,
  };
  return classifyFacts(input).approved;
}

const empty = { text: "", usedFactIds: [] };
/** What the model returned on the 2026-09-23 v14 draft, abridged — every
 *  section this module replaces carried an invented sentence. */
function modelDraft(): DefenceNarrativeOutput {
  return {
    executiveSummary: { text: "The available carrier records support the conclusion that both items left the merchant.", usedFactIds: [] },
    transactionOverviewArgument: { text: "The carrier records document the status of each shipment.", usedFactIds: [] },
    chronologyArgument: { text: "The Back to School Bundle was subsequently fulfilled via GOFO.", usedFactIds: [] },
    fulfillmentArgument: { text: "USPS holds no carrier-confirmed delivery record for this parcel at the time of filing.", usedFactIds: [] },
    conclusion: { text: "The claim of non-receipt is not consistent with the carrier record for the GOFO shipment.", usedFactIds: [] },
    paymentAuthenticationArgument: empty,
    communicationArgument: empty,
    policyArgument: empty,
    manualEvidenceArgument: empty,
    omittedSections: [
      { sectionKey: "paymentAuthenticationArgument", reason: "n/a" },
      { sectionKey: "communicationArgument", reason: "n/a" },
      { sectionKey: "policyArgument", reason: "n/a" },
      { sectionKey: "manualEvidenceArgument", reason: "n/a" },
    ],
    warnings: [],
  };
}

describe("multi-parcel non-receipt letters are written from the records", () => {
  const facts = classify([SUNSCREEN, BUNDLE]);
  const out = applyShipmentRecordSections(modelDraft(), facts);
  const all = [
    out.executiveSummary.text,
    out.transactionOverviewArgument.text,
    out.fulfillmentArgument.text,
    out.chronologyArgument.text,
    out.conclusion.text,
  ].join("\n");

  it("Case A: each parcel only by its own record", () => {
    expect(out.fulfillmentArgument.text).toBe(
      [
        "The order was fulfilled in two shipments.",
        "The Back to School Bundle: GOFO tracking number YT2640221437435982 (https://www.gofo.com/us/track?searchID=YT2640221437435982). GOFO's tracking record first shows the shipment in transit on 17 September 2026.",
        "Sunburst Mineral SPF 50 Sunscreen: fulfilled by the merchant on 16 September 2026 (USPS shipping reference 260914OET4).",
      ].join("\n\n"),
    );
  });

  it("one timeline: no chronology paragraph; the parcel events join the dated bullets", async () => {
    expect(out.chronologyArgument.text).toBe("");
    expect(out.omittedSections.map((o) => o.sectionKey)).toContain("chronologyArgument");
    const { buildChronologyEvents } = await import("../chronology");
    const events = buildChronologyEvents(
      {
        timelineEvents: [
          { at: "2026-08-22T16:16:00Z", text: "$129.00 USD was captured using a Visa ending in 9720 via Shop Pay." },
          { at: "2026-09-15T19:25:25Z", text: "Stallion marked 1 item as fulfilled from Canada." },
          { at: "2026-09-16T18:53:06Z", text: "Easy Fulfillment: Bulk Fulfill marked 1 item as fulfilled from Canada." },
        ],
      },
      facts,
    );
    expect(events.map((e) => e.text)).toEqual([
      "$129.00 USD was captured using a Visa ending in 9720 via Shop Pay.",
      "Stallion marked 1 item as fulfilled from Canada (The Back to School Bundle).",
      "Easy Fulfillment: Bulk Fulfill marked 1 item as fulfilled from Canada (Sunburst Mineral SPF 50 Sunscreen).",
      "GOFO's tracking record shows The Back to School Bundle in transit (tracking YT2640221437435982).",
    ]);
  });

  it("the timeline-only fulfilment time never reaches the model", async () => {
    const { stripDeliveryHashInputs } = await import("../narrativeWriter");
    const f = facts.find((x) => x.category === "delivery_proof")!;
    const stripped = stripDeliveryHashInputs(f.value) as Record<string, unknown>;
    for (const s of stripped.shipments as Array<Record<string, unknown>>) {
      expect(s).not.toHaveProperty("fulfillmentEventAt");
    }
  });

  it("each section says something new: the parcels in full once, the request never twice", () => {
    expect(out.executiveSummary.text).toBe(
      "The order was fulfilled in two shipments: The Back to School Bundle, which GOFO's tracking record first shows in transit on 17 September 2026; and Sunburst Mineral SPF 50 Sunscreen, fulfilled by the merchant on 16 September 2026.",
    );
    expect(out.transactionOverviewArgument.text).toBe("");
    expect(out.omittedSections.map((o) => o.sectionKey)).toContain("transactionOverviewArgument");
    expect(out.conclusion.text).toBe(
      "The request rests on GOFO's tracking record and the merchant's fulfilment records set out above.",
    );
    expect(out.conclusion.text).not.toMatch(/request(s|ed)? (that|reversal)|reversed/i);
    // Identifiers and links appear in the fulfilment section only.
    for (const k of ["executiveSummary", "chronologyArgument", "conclusion"] as const) {
      expect(out[k].text, k).not.toMatch(/YT2640221437435982|260914OET4|https?:/);
    }
  });

  it("no invented sentence survives, and nothing the stance forbids appears", () => {
    for (const bad of [
      /subsequently/i,
      /not consistent/i,
      /holds no|no carrier|no delivery/i,
      /left the merchant/i,
      /retrieved/i,
      /in transit since/i,
      /prior to|before the/i,
      /tracking number 260914OET4/i,
      /15 September/, // GOFO's fulfilment date: carrier-recorded parcels carry none
    ]) {
      expect(all, String(bad)).not.toMatch(bad);
    }
  });

  it("passes the full validator with the INR family and the live constraints", () => {
    const res = validateNarrative({
      narrative: out,
      approvedFacts: facts,
      reasonCodeModule: module_,
      packageMode: "full",
      internalOnlyFactIds: [],
      extraHardPhrases: item_not_received.prohibitedBankPhrases,
      guardedPhrases: item_not_received.guardedBankPhrases,
      internalConstraints: {
        ...NO_INTERNAL_CONSTRAINTS,
        refundOrCompensationRequested: { messageIds: ["m"], firstSentAt: "2026-09-05T16:15:25Z" },
        carrierPossessionUndated: carrierPossessionUndated(facts, "2026-09-19T00:15:40Z"),
      },
    });
    expect(res.errors).toEqual([]);
  });

  it("keeps the model's other sections", () => {
    const draft = modelDraft();
    draft.policyArgument = { text: "Policy text.", usedFactIds: [] };
    expect(applyShipmentRecordSections(draft, facts).policyArgument.text).toBe("Policy text.");
  });

  it("a delivered parcel is stated with its carrier date", () => {
    const delivered = {
      ...BUNDLE,
      shipmentProofType: "delivered_confirmed",
      displayStatus: "DELIVERED",
      deliveredAt: "2026-09-20T12:00:00Z",
    };
    const text = applyShipmentRecordSections(modelDraft(), classify([SUNSCREEN, delivered])).fulfillmentArgument.text;
    expect(text).toContain("GOFO's record confirms delivery on 20 September 2026.");
  });

  it("a single-parcel letter is left to the model", () => {
    const draft = modelDraft();
    expect(applyShipmentRecordSections(draft, classify([BUNDLE]))).toBe(draft);
  });
});
