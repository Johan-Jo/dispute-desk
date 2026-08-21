/**
 * Cross-source contradiction gate — pinned against the live case.
 *
 * The payload shapes below are copied from cay-collective #13195's pack
 * on production (2026-08-20), not invented: `carrierTracking`,
 * `carrierTerminalEvent` and the `returnStatus: "NO_RETURN"` section are
 * exactly what the collectors wrote. Pinning the real shape is the same
 * discipline `lib/carriers/__tests__/dhl.test.ts` applies to receipts —
 * a fixture that drifts from production tests nothing.
 */

import { describe, it, expect } from "vitest";
import {
  applyContradictionGate,
  hasReturnedToSenderShipment,
  returnedToSenderAt,
} from "../contradictionGate";
import type { EvidenceSection } from "../types";

/** #13195's shipping section, verbatim in the parts that matter. */
function returnedShippingSection(): EvidenceSection {
  return {
    type: "shipping",
    labelToken: { key: "packs.section.fulfillments", params: { count: 1 } },
    source: "shopify_fulfillments",
    fieldsProvided: ["shipping_tracking", "delivery_proof"],
    data: {
      proofType: "returned_to_sender",
      deliveredAt: null,
      overallStatus: "FULFILLED",
      deliveryCoverage: "none",
      fulfillmentCount: 1,
      sourceConflict: false,
      signedByName: null,
      fulfillments: [
        {
          fulfillmentId: "gid://shopify/Fulfillment/7329764770058",
          status: "SUCCESS",
          displayStatus: "FULFILLED",
          createdAt: "2026-06-18T15:10:25Z",
          deliveredAt: null,
          estimatedDeliveryAt: null,
          sourceConflict: false,
          items: [{ title: "Duktig jämt", quantity: 1 }],
          tracking: [
            {
              carrier: "DHL Freight",
              number: "6069930029",
              url: "https://www.logistics.dhl/se-en/home/tracking/tracking-freight.html?tracking-id=373325386418989795",
            },
          ],
          carrierTracking: {
            deliveryStatus: "Returned",
            deliveredAtTracking: null,
            signedByName: null,
            trackingSource: "carrier_api_dhl",
          },
          carrierTerminalEvent: {
            message: "Shipment returned to sender",
            happenedAt: "2026-07-06T09:40:00",
          },
        },
      ],
    },
  };
}

/** The section whose INFERENCE the carrier refutes. */
function noReturnSection(): EvidenceSection {
  return {
    type: "order",
    labelToken: { key: "packs.section.noReturnInitiated" },
    source: "shopify_order",
    fieldsProvided: ["no_return_initiated"],
    data: { returnStatus: "NO_RETURN" },
  };
}

function deliveredShippingSection(): EvidenceSection {
  const s = returnedShippingSection();
  const data = s.data as Record<string, unknown>;
  data.proofType = "delivered_confirmed";
  const f = (data.fulfillments as Array<Record<string, unknown>>)[0];
  f.carrierTracking = {
    deliveryStatus: "Delivered",
    deliveredAtTracking: "2026-06-21T11:02:00Z",
    signedByName: null,
    trackingSource: "carrier_api_dhl",
  };
  delete f.carrierTerminalEvent;
  return s;
}

describe("applyContradictionGate — no_return_initiated vs returned_to_sender", () => {
  it("drops the no-return section when the carrier brought the parcel back", () => {
    const result = applyContradictionGate([
      noReturnSection(),
      returnedShippingSection(),
    ]);
    expect(
      result.sections.some((s) => s.fieldsProvided.includes("no_return_initiated")),
    ).toBe(false);
    // ...and keeps the carrier fact. We drop the INFERENCE, never the
    // observation that survived contact with reality.
    expect(
      result.sections.some((s) => s.fieldsProvided.includes("delivery_proof")),
    ).toBe(true);
  });

  it("records the suppression rather than performing it silently", () => {
    const result = applyContradictionGate([
      noReturnSection(),
      returnedShippingSection(),
    ]);
    expect(result.contradictions).toHaveLength(1);
    const [c] = result.contradictions;
    expect(c.rule).toBe("no_return_vs_returned_to_sender");
    expect(c.suppressedField).toBe("no_return_initiated");
    expect(c.refutedBy).toBe("carrier_delivery_state");
    // The date is what makes the record diagnosable a year from now.
    expect(c.detail).toContain("2026-07-06");
  });

  it("leaves the no-return section alone when nothing came back", () => {
    const result = applyContradictionGate([
      noReturnSection(),
      deliveredShippingSection(),
    ]);
    expect(
      result.sections.some((s) => s.fieldsProvided.includes("no_return_initiated")),
    ).toBe(true);
    expect(result.contradictions).toHaveLength(0);
  });

  it("returns the input untouched when there is nothing to reconcile", () => {
    const sections = [deliveredShippingSection()];
    const result = applyContradictionGate(sections);
    expect(result.sections).toBe(sections);
    expect(result.contradictions).toEqual([]);
  });

  it("fires on a per-fulfillment Returned even if the section proofType is stale", () => {
    // A multi-parcel order can reach a positive section-level proofType
    // while one shipment still came back. The gate reads both.
    const mixed = returnedShippingSection();
    (mixed.data as Record<string, unknown>).proofType = "delivered_unverified";
    const result = applyContradictionGate([noReturnSection(), mixed]);
    expect(result.contradictions).toHaveLength(1);
  });
});

describe("hasReturnedToSenderShipment / returnedToSenderAt", () => {
  it("detects the returned parcel and its terminal date", () => {
    const sections = [noReturnSection(), returnedShippingSection()];
    expect(hasReturnedToSenderShipment(sections)).toBe(true);
    expect(returnedToSenderAt(sections)).toBe("2026-07-06T09:40:00");
  });

  it("is false for a delivered order", () => {
    expect(hasReturnedToSenderShipment([deliveredShippingSection()])).toBe(false);
    expect(returnedToSenderAt([deliveredShippingSection()])).toBeNull();
  });

  it("ignores non-delivery sections carrying lookalike data", () => {
    const decoy: EvidenceSection = {
      type: "other",
      labelToken: { key: "packs.section.paymentVerification" },
      source: "shopify_transactions",
      fieldsProvided: ["avs_cvv_match"],
      data: { proofType: "returned_to_sender" },
    };
    expect(hasReturnedToSenderShipment([decoy])).toBe(false);
  });
});
