/**
 * Non-receipt P0 (b), (f), (g) — docs/plans/non-receipt-delivery-evidence.plan.md.
 *
 * Case A (blume-box #360980) holds two shipments on one order: a USPS
 * "260914OET4" row that is a shipping-app BATCH reference (PR #758), listed
 * first, and the real GOFO parcel "YT2640221437435982", in transit. Before this
 * change the delivery fact paired the first tracking row with the section's
 * tier, nothing was bank-citable, and the letter argued from "no return".
 */

import { describe, it, expect } from "vitest";
import { classifyFacts, type ClassifyFactsInput, type PackSectionLike } from "../factClassifier";
import { resolveReasonCodeModuleForContext } from "../reasonCodes/registry";
import { rankStrategies } from "../strategies/registry";
import { computeEvidenceHash } from "../computeEvidenceHash";
import { runPhraseAndGuardChecks } from "../validateNarrative";
import { item_not_received } from "../reasonCodes/families/item_not_received";
import { categorizeEvidenceField } from "@/lib/argument/canonicalEvidence";
import type { EvidenceFact } from "../types";

const USPS_BATCH = {
  fulfillmentId: "gid://shopify/Fulfillment/1",
  displayStatus: "FULFILLED",
  shipmentProofType: "label_created",
  carrierStatusObservedAt: "2026-09-23T10:00:00Z",
  deliveredAt: null,
  tracking: [{ number: "260914OET4", carrier: "USPS", url: null }],
};
const GOFO = {
  fulfillmentId: "gid://shopify/Fulfillment/2",
  displayStatus: "IN_TRANSIT",
  shipmentProofType: "in_transit",
  carrierStatusObservedAt: "2026-09-23T10:00:00Z",
  deliveredAt: null,
  tracking: [{ number: "YT2640221437435982", carrier: "GOFO", url: null }],
};

function shippingSection(fulfillments: unknown[], proofType = "in_transit"): PackSectionLike {
  return {
    type: "shipping",
    label: "Fulfillments",
    source: "shopify_fulfillments",
    fieldsProvided: ["shipping_tracking", "delivery_proof"],
    data: { proofType, deliveredAt: null, fulfillments },
  };
}

function classify(sections: PackSectionLike[]) {
  const input: ClassifyFactsInput = {
    packageId: "pkg0",
    sections,
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

function deliveryFact(result: ReturnType<typeof classify>): EvidenceFact {
  const f = result.approved.find((x) => x.category === "delivery_proof");
  if (!f) throw new Error("no delivery_proof fact");
  return f;
}

describe("in_transit is supporting — never scored", () => {
  it("categorises as supporting", () => {
    expect(categorizeEvidenceField("delivery_proof", { proofType: "in_transit" })).toBe("supporting");
  });
});

describe("(b) Case A: the in-transit shipment becomes bank-citable, and only it", () => {
  it("cites GOFO, not the USPS batch reference listed first, and passes gate G1", () => {
    const r = classify([shippingSection([USPS_BATCH, GOFO])]);
    const f = deliveryFact(r);
    expect(f.value.carrier).toBe("GOFO");
    expect(f.value.trackingNumber).toBe("YT2640221437435982");
    expect(f.value.proofType).toBe("in_transit");
    expect(f.strength).toBe("supporting");
    expect(f.bankEligible).toBe(true);
    expect(f.includeInBankNarrative).toBe(true);
    // G1 (buildDefencePackageJob.ts:362) — eligible without no_return_initiated.
    expect(r.eligible).toBe(true);
    expect(r.predicateEvaluations.shipment_in_carrier_possession).toBe(true);
    expect(r.predicateEvaluations.delivery_confirmed).toBe(false);
  });

  it("selects the carrier-possession strategy, not the delivery stack", () => {
    const r = classify([shippingSection([USPS_BATCH, GOFO])]);
    const keys = rankStrategies({
      familyKey: "item_not_received",
      predicateEvaluations: r.predicateEvaluations,
      packageMode: r.packageMode,
    }).map((s) => s.key);
    expect(keys).toContain("item_not_received_carrier_possession");
    expect(keys).not.toContain("item_not_received_delivery_proof_stack");
  });

  it("label-only: no bank-citable fact, no carrier-possession licence", () => {
    const labelOnly = { ...GOFO, displayStatus: "FULFILLED", shipmentProofType: "label_created" };
    const r = classify([shippingSection([labelOnly], "label_created")]);
    expect(r.approved.every((x) => !x.bankEligible)).toBe(true);
    expect(r.predicateEvaluations.shipment_in_carrier_possession).toBe(false);
  });

  it("a batch reference alone never becomes citable, even marked in transit", () => {
    const batchInTransit = { ...USPS_BATCH, shipmentProofType: "in_transit", displayStatus: "IN_TRANSIT" };
    const r = classify([shippingSection([batchInTransit])]);
    expect(deliveryFact(r).bankEligible).toBe(false);
  });

  it("another supporting field stays non-citable (the exception is not general)", () => {
    const unverified = { ...GOFO, shipmentProofType: "delivered_unverified", displayStatus: "DELIVERED" };
    const r = classify([shippingSection([unverified], "delivered_unverified")]);
    expect(deliveryFact(r).bankEligible).toBe(false);
  });
});

describe("(f) shipment identity survives the projection", () => {
  it("reversed fulfillment order cites the same shipment with the same values and hash", () => {
    const a = deliveryFact(classify([shippingSection([USPS_BATCH, GOFO])]));
    const b = deliveryFact(classify([shippingSection([GOFO, USPS_BATCH])]));
    expect(b.value).toEqual(a.value);
    const hash = (f: EvidenceFact) =>
      computeEvidenceHash({ approvedFacts: [f], manualEvidence: [], reasonCode: "PRODUCT_NOT_RECEIVED" });
    expect(hash(b)).toBe(hash(a));
  });

  it("one delivered + one in transit: cites the delivered parcel with ITS OWN date", () => {
    const delivered = {
      fulfillmentId: "gid://shopify/Fulfillment/3",
      displayStatus: "DELIVERED",
      shipmentProofType: "delivered_confirmed",
      carrierStatusObservedAt: "2026-09-23T10:00:00Z",
      deliveredAt: "2026-09-18T16:23:00Z",
      tracking: [{ number: "00573132901924649740", carrier: "PostNord SE", url: null }],
    };
    const f = deliveryFact(classify([shippingSection([GOFO, delivered], "delivered_confirmed")]));
    expect(f.value.carrier).toBe("PostNord SE");
    expect(f.value.trackingNumber).toBe("00573132901924649740");
    expect(f.value.deliveredAt).toBe("2026-09-18T16:23:00Z");
    expect(f.value.proofType).toBe("delivered_confirmed");
  });
});

describe("(g) hashing: an unchanged re-read does not rotate the hash; a status change does", () => {
  const hashOf = (fulfillments: unknown[], proofType?: string) =>
    computeEvidenceHash({
      approvedFacts: classify([shippingSection(fulfillments, proofType)]).approved,
      manualEvidence: [],
      reasonCode: "PRODUCT_NOT_RECEIVED",
    });

  it("a new carrierStatusObservedAt alone → same hash", () => {
    const later = { ...GOFO, carrierStatusObservedAt: "2026-09-24T02:32:00Z" };
    expect(hashOf([USPS_BATCH, later])).toBe(hashOf([USPS_BATCH, GOFO]));
  });

  it("IN_TRANSIT → DELIVERED → different hash", () => {
    const delivered = {
      ...GOFO,
      displayStatus: "DELIVERED",
      shipmentProofType: "delivered_confirmed",
      deliveredAt: "2026-09-25T10:00:00Z",
    };
    expect(hashOf([USPS_BATCH, delivered], "delivered_confirmed")).not.toBe(hashOf([USPS_BATCH, GOFO]));
  });
});

describe("shipment-scoped validation (§4.1(b), test 3e)", () => {
  const facts = classify([shippingSection([USPS_BATCH, GOFO])]).approved;
  const check = (text: string) =>
    runPhraseAndGuardChecks({
      text,
      sectionKey: "fulfillmentArgument",
      approvedFacts: facts,
      packageMode: "full",
      layer: "narrative",
      extraHardPhrases: item_not_received.prohibitedBankPhrases,
      guardedPhrases: item_not_received.guardedBankPhrases,
    }).filter((e) => e.rule === "forbidden_phrase");

  it("refuses a transit claim about the USPS batch reference, although GOFO satisfies the predicate", () => {
    expect(check("The USPS shipment 260914OET4 is in transit.").length).toBeGreaterThan(0);
  });

  it("passes the same claim about GOFO", () => {
    expect(
      check("The carrier's record shows GOFO shipment YT2640221437435982 in transit (status as retrieved on 23 September 2026)."),
    ).toEqual([]);
  });

  it("refuses an unnamed transit claim on a two-shipment order where only one is in transit", () => {
    expect(check("The order is in transit.").length).toBeGreaterThan(0);
  });

  it("a label-only case can never write a carrier-possession sentence", () => {
    const labelOnly = { ...GOFO, displayStatus: "FULFILLED", shipmentProofType: "label_created" };
    const labelFacts = classify([shippingSection([labelOnly], "label_created")]).approved;
    const errs = runPhraseAndGuardChecks({
      text: "The GOFO shipment YT2640221437435982 is in transit.",
      sectionKey: "fulfillmentArgument",
      approvedFacts: labelFacts,
      packageMode: "full",
      layer: "narrative",
      guardedPhrases: item_not_received.guardedBankPhrases,
    });
    expect(errs.some((e) => e.rule === "forbidden_phrase")).toBe(true);
  });
});

describe("Evidence Basis prints the in-transit status honestly", () => {
  it("never 'Confirmed'; dated as a retrieval", async () => {
    const { buildEvidenceBasisRows } = await import("../pdf/evidenceBasisRows");
    const facts = classify([shippingSection([USPS_BATCH, GOFO])]).approved;
    const rows = buildEvidenceBasisRows(facts);
    const text = JSON.stringify(rows);
    expect(text).toContain("In transit with the carrier");
    expect(text).toContain("status as retrieved");
    expect(text).not.toContain("Confirmed");
    expect(text).not.toContain("260914OET4");
  });
});
