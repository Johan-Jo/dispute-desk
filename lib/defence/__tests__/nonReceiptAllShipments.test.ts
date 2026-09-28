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
import { buildEvidenceBasisRows } from "../pdf/evidenceBasisRows";
import { inTransitSinceOf } from "@/lib/packs/sources/fulfillmentSource";

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
    // A carrier-recorded parcel carries no fulfilment date (prompt v22).
    expect(gofo.fulfilledAt).toBeNull();
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

describe("the dated in-transit event (validator v11, prompt v21)", () => {
  // Shopify holds ONE event for the GOFO parcel: IN_TRANSIT, 17 Sep 03:48 UTC.
  const DATED = { ...BUNDLE, inTransitSince: "2026-09-17T03:48:42Z" };

  it("the collector takes the earliest in-carrier event, never a label or pickup-ready event", () => {
    const ev = (status: string, happenedAt: string) => ({ node: { status, happenedAt, message: null } });
    expect(
      inTransitSinceOf({
        events: { edges: [ev("LABEL_PURCHASED", "2026-09-15T19:00:00Z"), ev("IN_TRANSIT", "2026-09-18T00:00:00Z"), ev("IN_TRANSIT", "2026-09-17T03:48:42Z"), ev("READY_FOR_PICKUP", "2026-09-16T00:00:00Z")] },
      } as never),
    ).toBe("2026-09-17T03:48:42Z");
    expect(inTransitSinceOf({ events: { edges: [ev("LABEL_PURCHASED", "2026-09-15T19:00:00Z")] } } as never)).toBeNull();
    expect(inTransitSinceOf({} as never)).toBeNull();
  });

  it("the cited fact and the shipment entry carry it", () => {
    const f = deliveryFact(classify([SUNSCREEN, DATED]));
    expect(f.value.inTransitSince).toBe("2026-09-17T03:48:42Z");
    const gofo = (f.value.shipments as Shipment[]).find((s) => s.carrier === "GOFO")!;
    expect(gofo.inTransitSince).toBe("2026-09-17T03:48:42Z");
  });

  it("custody may be related to the dispute only when the event precedes it", () => {
    const dated = classify([SUNSCREEN, DATED]).approved;
    const undated = classify([SUNSCREEN, BUNDLE]).approved;
    expect(carrierPossessionUndated(dated, "2026-09-19T00:15:40Z")).toBe(false);
    expect(carrierPossessionUndated(dated, "2026-09-16T00:00:00Z")).toBe(true); // event after opening
    expect(carrierPossessionUndated(dated, null)).toBe(true);
    expect(carrierPossessionUndated(undated, "2026-09-19T00:15:40Z")).toBe(true);
  });
});

describe("Evidence Basis: one row per parcel, never the same row twice", () => {
  const DATED = { ...BUNDLE, inTransitSince: "2026-09-17T03:48:42Z" };

  it("Case A: GOFO dated from its event with a link; USPS as a fulfilment record without one", () => {
    // Prod shape: two per-parcel records of the SAME fact (delivery_proof twice).
    const facts = classify([SUNSCREEN, DATED]).approved;
    const dp = facts.filter((f) => f.category === "delivery_proof");
    const doubled = [...facts, ...dp.map((f) => ({ ...f, id: f.id + "-2" }))];
    const rows = buildEvidenceBasisRows(doubled).filter(
      (r) => r.category === "delivery_proof" || r.category === "shipping_tracking",
    );
    expect(rows).toHaveLength(2);
    const gofo = rows.find((r) => r.label.includes("Back to School"))!;
    expect(gofo.value).toContain("In transit (first carrier event Sep 17, 2026");
    expect(gofo.value).not.toContain("Fulfilled");
    expect(gofo.value).not.toContain("retrieved");
    expect(gofo.link?.url).toContain("YT2640221437435982");
    const usps = rows.find((r) => r.label.includes("Sunscreen"))!;
    expect(usps.value).toContain("USPS shipping reference 260914OET4");
    expect(usps.value).not.toMatch(/transit|deliver/i);
    expect(usps.link).toBeNull();
  });

  it("a single shipment still renders one row, dated from its event", () => {
    const rows = buildEvidenceBasisRows(classify([DATED]).approved).filter(
      (r) => r.category === "delivery_proof" || r.category === "shipping_tracking",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toContain("first carrier event");
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

  it.each([
    "The merchant fulfilled The Back to School Bundle on 15 September 2026, four days before the dispute was opened.",
    "The order was fulfilled prior to the chargeback.",
    "The sunscreen was fulfilled 25 days after the order.",
    "The bundle shipped 24 days after the purchase.",
  ])("v12: refuses fulfilment timing: %s", (text) => {
    expect(check(text).length).toBeGreaterThan(0);
  });

  describe("v13 on the v12 draft, with GOFO dated", () => {
    const datedFacts = classify([SUNSCREEN, { ...BUNDLE, inTransitSince: "2026-09-17T03:48:42Z" }]).approved;
    const chk = (text: string) =>
      runPhraseAndGuardChecks({
        text,
        sectionKey: "fulfillmentArgument",
        approvedFacts: datedFacts,
        packageMode: "full",
        layer: "narrative",
        extraHardPhrases: item_not_received.prohibitedBankPhrases,
        guardedPhrases: item_not_received.guardedBankPhrases,
        internalConstraints: NO_INTERNAL_CONSTRAINTS,
      }).filter((e) => e.rule === "forbidden_phrase");

    it.each([
      // Verbatim, refused by v12 although true.
      "The Back to School Bundle (quantity 1) was tendered to GOFO (tracking YT2640221437435982; https://www.gofo.com/us/track?searchID=YT2640221437435982). The carrier's tracking record shows the shipment in transit since 17 September 2026.",
      "GOFO's tracking record (YT2640221437435982) shows The Back to School Bundle in transit since 17 September 2026, and the Sunburst Mineral SPF 50 Sunscreen was fulfilled on 16 September 2026 under USPS shipping reference 260914OET4.",
    ])("passes: %s", (text) => {
      expect(chk(text)).toEqual([]);
    });

    it.each([
      // Verbatim, correctly refused.
      "The order records confirm that both items left the merchant's possession and were tendered to their respective carriers prior to the filing of this dispute.",
      "The available records demonstrate that the merchant fulfilled both items in this order and tendered them to their respective carriers prior to the dispute.",
      // Clause split must not launder a USPS claim.
      "GOFO's record shows the bundle in transit, and the USPS parcel (260914OET4) is in transit too.",
    ])("refuses: %s", (text) => {
      expect(chk(text).length).toBeGreaterThan(0);
    });

    it("the dated citation carries no retrieval time", () => {
      const f = deliveryFact(classify([SUNSCREEN, { ...BUNDLE, inTransitSince: "2026-09-17T03:48:42Z" }]));
      expect(f.value).not.toHaveProperty("carrierStatusObservedAt");
      const gofo = (f.value.shipments as Shipment[]).find((s) => s.carrier === "GOFO")!;
      expect(gofo).not.toHaveProperty("carrierStatusObservedAt");
    });
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

  it("v14: a carrier-confirmed delivery may be placed before the dispute (#352543, verbatim)", () => {
    expect(
      check(
        "The available evidence supports the conclusion that the shipment was delivered prior to the dispute being raised.",
        NO_INTERNAL_CONSTRAINTS,
      ),
    ).toEqual([]);
  });

  it("v14: …but not when the delivery post-dates the dispute (data-checked)", () => {
    expect(
      check("The shipment was delivered prior to the dispute being raised.", {
        ...NO_INTERNAL_CONSTRAINTS,
        deliveryPostDatesDispute: true,
      }).length,
    ).toBeGreaterThan(0);
  });

  it.each([
    "The merchant tendered both parcels to the carriers prior to the filing of this dispute.",
    "The goods left the merchant's possession before the chargeback.",
    "The parcel was in transit before the dispute was opened.",
  ])("v14: refuses custody placed before the dispute: %s", (text) => {
    expect(check(text, NO_INTERNAL_CONSTRAINTS).length).toBeGreaterThan(0);
  });
});
