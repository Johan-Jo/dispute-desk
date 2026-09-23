/**
 * Every shipment on the order reaches the letter, each described only by its
 * own record (validator v7, prompt v18).
 *
 * blume-box #360980, live pack 2026-09-23: The Back to School Bundle left with
 * GOFO (YT2640221437435982, in transit) and the sunscreen with USPS under the
 * shipping-app reference 260914OET4 (fulfilled, no carrier event). The first
 * letter named GOFO only, said "No delivery confirmation or signature event has
 * been recorded … and the merchant does not assert otherwise", and placed the
 * carrier's custody "prior to the filing of this dispute" — which no record
 * dates.
 */

import { describe, it, expect } from "vitest";
import { classifyFacts, type ClassifyFactsInput, type PackSectionLike } from "../factClassifier";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { computeEvidenceHash } from "../computeEvidenceHash";
import { runPhraseAndGuardChecks } from "../validateNarrative";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import {
  carrierPossessionUndated,
  NO_INTERNAL_CONSTRAINTS,
  type InternalNarrativeConstraints,
} from "../internalConstraints";
import type { EvidenceFact } from "../types";

const hashOf = (approvedFacts: EvidenceFact[]) =>
  computeEvidenceHash({ approvedFacts, manualEvidence: [], reasonCode: "PRODUCT_NOT_RECEIVED" });

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
};

function section(fulfillments: unknown[]): PackSectionLike {
  return {
    type: "shipping",
    label: "Fulfillments",
    source: "shopify_fulfillments",
    fieldsProvided: ["shipping_tracking", "delivery_proof"],
    data: { proofType: "delivered_unverified", deliveredAt: null, fulfillments },
  };
}

function classify(fulfillments: unknown[]) {
  const input: ClassifyFactsInput = {
    packageId: "pkg0",
    sections: [section(fulfillments)],
    evidenceItems: [],
    checklist: [],
    coverage: { state: "not_covered" },
    fatalLoss: { triggered: false, reason: null },
    caseStrength: "weak",
    manualRows: [],
    reasonCodeModule: resolveReasonCodeModuleForContext(null, "PRODUCT_NOT_RECEIVED"),
  };
  return classifyFacts(input);
}

function deliveryFact(r: ReturnType<typeof classify>): EvidenceFact {
  const f = r.approved.find((x) => x.category === "delivery_proof");
  if (!f) throw new Error("no delivery_proof fact");
  return f;
}

type Shipment = Record<string, unknown>;

describe("every shipment reaches the delivery fact", () => {
  it("Case A: both parcels, each with only what its own record supports", () => {
    const f = deliveryFact(classify([SUNSCREEN, BUNDLE]));
    expect(f.value.carrier).toBe("GOFO");
    const shipments = f.value.shipments as Shipment[];
    expect(shipments).toHaveLength(2);

    const usps = shipments.find((s) => s.carrier === "USPS")!;
    expect(usps.reference).toBe("260914OET4");
    expect(usps.referenceIsTrackingNumber).toBe(false);
    expect(usps.trackingUrl).toBeNull();
    expect(usps.fulfilledAt).toBe("2026-09-16T18:53:06Z");
    expect(usps.items).toEqual([{ title: "Sunburst Mineral SPF 50 Sunscreen", quantity: 1 }]);
    expect(usps.deliveredAt).toBeNull();
    expect(usps).not.toHaveProperty("carrierStatusObservedAt");

    const gofo = shipments.find((s) => s.carrier === "GOFO")!;
    expect(gofo.referenceIsTrackingNumber).toBe(true);
    expect(gofo.trackingUrl).toContain("YT2640221437435982");
    expect(gofo.proofType).toBe("in_transit");
    expect(gofo.carrierStatusObservedAt).toBe("2026-09-23T16:44:50.439Z");
    expect(gofo.fulfilledAt).toBe("2026-09-15T19:25:25Z");
  });

  it("array order changes neither the list nor the hash", () => {
    const a = classify([SUNSCREEN, BUNDLE]);
    const b = classify([BUNDLE, SUNSCREEN]);
    expect(deliveryFact(a).value.shipments).toEqual(deliveryFact(b).value.shipments);
    expect(hashOf(a.approved)).toBe(hashOf(b.approved));
  });

  it("a new status read alone does not rotate the hash", () => {
    const later = { ...BUNDLE, carrierStatusObservedAt: "2026-09-24T09:00:00Z" };
    expect(hashOf(classify([SUNSCREEN, BUNDLE]).approved)).toBe(
      hashOf(classify([SUNSCREEN, later]).approved),
    );
  });

  it("a single shipment carries no list (the fact already describes it)", () => {
    expect(deliveryFact(classify([BUNDLE])).value).not.toHaveProperty("shipments");
  });

  it("a returned parcel is never volunteered", () => {
    const returned = { ...SUNSCREEN, shipmentProofType: "returned_to_sender" };
    const third = { ...SUNSCREEN, fulfillmentId: "gid://shopify/Fulfillment/9", tracking: [{ number: "9400111899223456789012", carrier: "USPS", url: null }] };
    const shipments = deliveryFact(classify([returned, BUNDLE, third])).value.shipments as Shipment[];
    expect(shipments).toHaveLength(2);
    expect(shipments.some((s) => s.proofType === "returned_to_sender")).toBe(false);
  });
});

describe("validator v7 on Case A's first letter", () => {
  const facts = classify([SUNSCREEN, BUNDLE]).approved;
  const constraints: InternalNarrativeConstraints = {
    ...NO_INTERNAL_CONSTRAINTS,
    carrierPossessionUndated: carrierPossessionUndated(facts),
  };
  const check = (text: string, c: InternalNarrativeConstraints = constraints) =>
    runPhraseAndGuardChecks({
      text,
      sectionKey: "chronologyArgument",
      approvedFacts: facts,
      packageMode: "full",
      layer: "narrative",
      extraHardPhrases: item_not_received.prohibitedBankPhrases,
      guardedPhrases: item_not_received.guardedBankPhrases,
      internalConstraints: c,
    }).filter((e) => e.rule === "forbidden_phrase");

  it("the constraint is set by an in-transit citation", () => {
    expect(constraints.carrierPossessionUndated).toBe(true);
  });

  it.each([
    // Verbatim from the 2026-09-23 draft.
    "No delivery confirmation or signature event has been recorded as of that retrieval date, and the merchant does not assert otherwise.",
    "The timeline of events — order creation, carrier hand-off, and active in-transit status — is consistent with a shipment that left the merchant's possession and entered the carrier network prior to the filing of this dispute.",
    "The available evidence supports the conclusion that the Item Not Received claim is premature given the active in-transit status of the shipment at the time this dispute was filed.",
    // Paraphrases.
    "The parcel has not yet been delivered.",
    "The shipment remains undelivered.",
    "GOFO accepted the parcel before the chargeback was opened.",
    // A shipping reference presented as a tracking number.
    "The sunscreen was sent via USPS under tracking number 260914OET4.",
  ])("refuses: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it.each([
    "The merchant fulfilled The Back to School Bundle on 15 September 2026; GOFO's record shows the shipment in transit under tracking number YT2640221437435982 (status as retrieved on 23 September 2026).",
    "The merchant fulfilled the Sunburst Mineral SPF 50 Sunscreen on 16 September 2026 via USPS, shipping reference 260914OET4.",
    "The order was fulfilled in two shipments.",
  ])("passes: %s", (text) => {
    expect(check(text)).toEqual([]);
  });

  it("v8: a sentence referring back to the shipment named before it is read against THAT shipment", () => {
    // Verbatim from the v7 rebuild, 2026-09-23 — failed validation, true.
    const para =
      "Shipment 1 — The Back to School Bundle (quantity 1): The merchant fulfilled this item on 15 September 2026 via GOFO, tracking number YT2640221437435982 (https://www.gofo.com/us/track?searchID=YT2640221437435982). The carrier's record shows this shipment in transit, with that status as retrieved on 23 September 2026.";
    expect(check(para)).toEqual([]);
  });

  it("v8: the referent does not cross a paragraph, and a bare claim still has none", () => {
    const text =
      "The merchant fulfilled this item on 15 September 2026 via GOFO, tracking number YT2640221437435982.\n\nThe carrier's record shows this shipment in transit.";
    expect(check(text).length).toBeGreaterThan(0);
    expect(check("The order is in transit.").length).toBeGreaterThan(0);
  });

  it("v8: referring back to the USPS reference cannot borrow GOFO's status", () => {
    const text =
      "The merchant fulfilled the sunscreen on 16 September 2026 via USPS, shipping reference 260914OET4. The carrier's record shows this shipment in transit.";
    expect(check(text).length).toBeGreaterThan(0);
  });

  it.each([
    // Verbatim from the v7 rebuild: USPS custody with no carrier record.
    "The merchant fulfilled Sunburst Mineral SPF 50 Sunscreen on 16 September 2026, tendering it to USPS (shipping reference 260914OET4).",
    "The merchant fulfilled each item and tendered each to its respective carrier.",
  ])("v8: refuses hand-over to a carrier with no record: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it.each([
    // Verbatim from the v8 rebuild, 2026-09-23.
    "The carrier records corroborate that both items left the merchant's possession following the transaction.",
    "Second, the merchant fulfilled the Sunburst Mineral SPF 50 Sunscreen on 16 September 2026; this item was tendered to USPS under shipping reference 260914OET4.",
  ])("v9: refuses: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it.each([
    // Verbatim from the validated v9 draft, 2026-09-23.
    "The merchant fulfilled these items across two separate shipments, each with its own carrier record.",
    "Both parcels have carrier tracking.",
    "The carrier records for each shipment confirm fulfilment.",
  ])("v10: refuses a carrier record claimed for every parcel: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  it("v10: a carrier record claimed for GOFO alone passes", () => {
    expect(check("GOFO's carrier record shows the shipment in transit (tracking YT2640221437435982).")).toEqual([]);
  });

  // Only the CITED shipment is bank-citable (shipmentRefsOf), so on any
  // multi-parcel order a whole-order carrier-record claim is refused; the
  // letter names each parcel instead (overlay rule). Conservative by design.
  it("v10: a whole-order carrier-record claim is refused on any multi-parcel order", () => {
    const both = classify([{ ...SUNSCREEN, shipmentProofType: "in_transit", tracking: [{ number: "9400111899223456789012", carrier: "USPS", url: null }] }, BUNDLE]).approved;
    const errs = runPhraseAndGuardChecks({
      text: "The order left in two shipments, each with its own carrier record.",
      sectionKey: "transactionOverviewArgument",
      approvedFacts: both,
      packageMode: "full",
      layer: "narrative",
      extraHardPhrases: item_not_received.prohibitedBankPhrases,
      guardedPhrases: item_not_received.guardedBankPhrases,
      internalConstraints: NO_INTERNAL_CONSTRAINTS,
    }).filter((e) => e.rule === "forbidden_phrase");
    expect(errs.length).toBeGreaterThan(0);
  });

  it("v9: the permitted shape for a parcel with no carrier record passes", () => {
    expect(
      check("The merchant fulfilled Sunburst Mineral SPF 50 Sunscreen on 16 September 2026 (USPS shipping reference 260914OET4)."),
    ).toEqual([]);
  });

  it("v8: hand-over to GOFO, whose record shows it in transit, passes", () => {
    expect(
      check("The merchant fulfilled The Back to School Bundle on 15 September 2026, tendering it to GOFO (tracking YT2640221437435982)."),
    ).toEqual([]);
  });

  it("custody timing is allowed when the delivery is carrier-dated (constraint off)", () => {
    expect(
      check("PostNord delivered the parcel before the dispute was opened.", NO_INTERNAL_CONSTRAINTS),
    ).toEqual([]);
  });
});
