/**
 * ROLLOUT BLOCKER — delivery status must be in the `evidence_hash` inputs.
 *
 * Plan: docs/plans/tracking-app-delivery-signals.plan.md §8.1.1, tests 13 & 17.
 *
 * ── What these guard ─────────────────────────────────────────────────
 *
 * The submission-time staleness backstop works by recomputing
 * `evidence_hash` from current facts and refusing to file a package whose
 * stored hash disagrees. That only protects anything if a delivery-state
 * change actually MOVES the hash.
 *
 * Before 2026-09-16 it moved only by coincidence. The delivery fact's value
 * carried no status field, so `Delivered → Returned` reached the hash
 * INDIRECTLY, through `proofType` flipping to `returned_to_sender`. That
 * held for a single-shipment order (the #98141 case) and broke for several:
 * `resolveProofType` takes a best-tier across shipments, so one parcel
 * delivered with a timestamp pins `proofType` at `delivered_confirmed` while
 * a second parcel returns unnoticed.
 *
 * Test 17 is the one that failed before the fix. It must keep passing, and
 * it must be understood as the reason `deliveryStatuses` is hashed under its
 * own name rather than inferred from `proofType`.
 */

import { describe, it, expect } from "vitest";
import { extractValueForTest } from "../factClassifier";
import { computeEvidenceHash } from "../computeEvidenceHash";
import type { EvidenceFact } from "../types";

/** One shipment as `fulfillmentSource` writes it into the section payload. */
function shipment(opts: {
  number: string;
  carrier?: string;
  deliveryStatus?: "Delivered" | "Returned" | "CollectedAtPickup" | "DeliveredToPickup";
  terminalAt?: string;
}) {
  return {
    tracking: [{ carrier: opts.carrier ?? "YunExpress", number: opts.number, url: null }],
    ...(opts.deliveryStatus
      ? {
          carrierTracking: { deliveryStatus: opts.deliveryStatus },
          carrierTerminalEvent: opts.terminalAt ? { happenedAt: opts.terminalAt } : null,
        }
      : {}),
  };
}

/** The delivery fact as it reaches the hash, via the real extractor. */
function deliveryFact(payload: Record<string, unknown>): EvidenceFact {
  return {
    id: "f-delivery",
    category: "delivery_confirmation",
    label: "Delivery confirmation",
    value: extractValueForTest("delivery_proof", payload),
    source: "shopify_order",
    sourceRef: null,
    strength: "strong",
    bankEligible: true,
    merchantVisible: true,
    internalOnly: false,
    includeInBankNarrative: true,
    submissionRisk: false,
    confidence: null,
  };
}

const hashOf = (payload: Record<string, unknown>) =>
  computeEvidenceHash({
    approvedFacts: [deliveryFact(payload)],
    manualEvidence: [],
    reasonCode: "13.1",
  });

describe("delivery status is a hash input (test 13)", () => {
  it("Delivered -> Returned moves the evidence hash", () => {
    // The #98141 shape: one parcel, delivered-to-pickup then returned.
    const delivered = {
      proofType: "delivered_unverified",
      deliveredAt: "2026-08-31T11:17:41Z",
      fulfillments: [
        shipment({ number: "YT2622600704220350", deliveryStatus: "Delivered" }),
      ],
    };
    const returned = {
      proofType: "returned_to_sender",
      deliveredAt: null,
      fulfillments: [
        shipment({
          number: "YT2622600704220350",
          deliveryStatus: "Returned",
          terminalAt: "2026-09-07T09:17:41Z",
        }),
      ],
    };

    expect(hashOf(delivered)).not.toBe(hashOf(returned));
  });

  it("carries the status under its own name, not only via proofType", () => {
    const value = extractValueForTest("delivery_proof", {
      proofType: "delivered_confirmed",
      fulfillments: [shipment({ number: "A1", deliveryStatus: "Returned", terminalAt: "2026-09-07T09:17:41Z" })],
    }) as Record<string, unknown>;

    expect(value.deliveryStatuses).toEqual(["Returned"]);
    expect(value.returnedAt).toBe("2026-09-07T09:17:41Z");
  });

  it("an unchanged delivery state leaves the hash alone (the gate is not vacuous)", () => {
    // Test 14: guards against a check that blocks everything and is therefore
    // never actually exercised.
    const payload = {
      proofType: "delivered_confirmed",
      deliveredAt: "2026-09-09T11:45:44Z",
      fulfillments: [shipment({ number: "YT2624300706784028", deliveryStatus: "Delivered" })],
    };
    expect(hashOf(payload)).toBe(hashOf({ ...payload }));
  });
});

describe("the multi-shipment hole (test 17)", () => {
  /**
   * Two shipments: one delivered with a timestamp, one that later returns.
   *
   * `resolveProofType` keeps `delivered_confirmed` because the delivered
   * parcel holds the best tier — so `proofType`, `deliveredAt`, `carrier` and
   * `trackingNumber` are all IDENTICAL across the two payloads below. Before
   * the fix every hashed field was therefore identical too, and a package
   * contradicted by its own tracking stayed fileable.
   */
  const before = {
    proofType: "delivered_confirmed",
    deliveredAt: "2026-09-01T10:00:00Z",
    fulfillments: [
      shipment({ number: "PARCEL-A", deliveryStatus: "Delivered" }),
      shipment({ number: "PARCEL-B", deliveryStatus: "DeliveredToPickup" }),
    ],
  };
  const after = {
    proofType: "delivered_confirmed",
    deliveredAt: "2026-09-01T10:00:00Z",
    fulfillments: [
      shipment({ number: "PARCEL-A", deliveryStatus: "Delivered" }),
      shipment({
        number: "PARCEL-B",
        deliveryStatus: "Returned",
        terminalAt: "2026-09-08T14:00:00Z",
      }),
    ],
  };

  it("proofType does NOT move — which is why proofType alone was insufficient", () => {
    expect(before.proofType).toBe(after.proofType);
    expect(before.deliveredAt).toBe(after.deliveredAt);
  });

  it("the hash moves anyway, because the statuses are hashed directly", () => {
    expect(hashOf(before)).not.toBe(hashOf(after));
  });

  it("records the return timestamp from the returned parcel only", () => {
    const value = extractValueForTest("delivery_proof", after) as Record<string, unknown>;
    expect(value.deliveryStatuses).toEqual(["Delivered", "Returned"]);
    expect(value.returnedAt).toBe("2026-09-08T14:00:00Z");
  });
});

describe("hash stability", () => {
  it("is not moved by shipment ordering, which carries no meaning", () => {
    const a = {
      proofType: "delivered_confirmed",
      fulfillments: [
        shipment({ number: "A", deliveryStatus: "Delivered" }),
        shipment({ number: "A", deliveryStatus: "Returned", terminalAt: "2026-09-08T14:00:00Z" }),
      ],
    };
    const b = {
      proofType: "delivered_confirmed",
      fulfillments: [
        shipment({ number: "A", deliveryStatus: "Returned", terminalAt: "2026-09-08T14:00:00Z" }),
        shipment({ number: "A", deliveryStatus: "Delivered" }),
      ],
    };
    expect(hashOf(a)).toBe(hashOf(b));
  });

  it("a shipment with no reconciled status contributes nothing", () => {
    // Absence of a carrier result is never evidence — it must not manufacture
    // a status, and it must not destabilise the hash.
    const value = extractValueForTest("delivery_proof", {
      proofType: "label_created",
      fulfillments: [shipment({ number: "A" })],
    }) as Record<string, unknown>;

    expect(value.deliveryStatuses).toEqual([]);
    expect(value.returnedAt).toBeNull();
  });
});
