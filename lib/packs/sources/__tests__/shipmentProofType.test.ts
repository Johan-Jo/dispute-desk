/**
 * Per-shipment proof tiers (non-receipt plan §5.1, §4.1(f)). The sixth state,
 * `in_transit`, sits between a printed label and any delivery signal.
 */

import { describe, it, expect } from "vitest";
import { resolveShipmentProofType } from "../fulfillmentSource";

type F = Parameters<typeof resolveShipmentProofType>[0];
type S = Parameters<typeof resolveShipmentProofType>[1];

const fulfillment = (over: Partial<F> = {}): F =>
  ({
    id: "gid://shopify/Fulfillment/1",
    status: "SUCCESS",
    displayStatus: "FULFILLED",
    createdAt: "2026-09-15T00:00:00Z",
    updatedAt: null,
    deliveredAt: null,
    estimatedDeliveryAt: null,
    trackingInfo: [{ number: "YT2640221437435982", url: null, company: "GOFO" }],
    fulfillmentLineItems: { edges: [] },
    ...over,
  }) as F;

const state = (over: Partial<S> = {}): S =>
  ({ current: null, conflict: false, signedBy: null, carrier: null, ...over }) as S;

describe("resolveShipmentProofType", () => {
  it("Shopify IN_TRANSIT → in_transit (Case A's GOFO parcel)", () => {
    expect(resolveShipmentProofType(fulfillment({ displayStatus: "IN_TRANSIT", status: "OPEN" }), state())).toBe("in_transit");
  });

  it("LIVE SHAPE: status SUCCESS + displayStatus IN_TRANSIT is in_transit, not unverified delivery", () => {
    // blume-box #360980 GOFO, exactly as Shopify returned it on 2026-09-23.
    // The bare SUCCESS flag used to win and graded it delivered_unverified.
    expect(resolveShipmentProofType(fulfillment({ displayStatus: "IN_TRANSIT", status: "SUCCESS" }), state())).toBe("in_transit");
  });

  it("a bare SUCCESS with no transit or delivery status stays delivered_unverified (unchanged)", () => {
    expect(resolveShipmentProofType(fulfillment({ displayStatus: "FULFILLED", status: "SUCCESS" }), state())).toBe("delivered_unverified");
  });

  it("OUT_FOR_DELIVERY and ATTEMPTED_DELIVERY are carrier possession too", () => {
    for (const displayStatus of ["OUT_FOR_DELIVERY", "ATTEMPTED_DELIVERY"]) {
      expect(resolveShipmentProofType(fulfillment({ displayStatus, status: "OPEN" }), state())).toBe("in_transit");
    }
  });

  it("a tracking number alone is a printed label, not possession", () => {
    expect(resolveShipmentProofType(fulfillment({ status: "OPEN" }), state())).toBe("label_created");
  });

  it("a carrier lookup with scans and no terminal event → in_transit", () => {
    const s = state({
      carrier: { shipment: { deliveryStatus: null, events: [{ happenedAt: "2026-09-16T00:00:00Z", message: "Accepted" }] } } as never,
    });
    expect(resolveShipmentProofType(fulfillment({ status: "OPEN" }), s)).toBe("in_transit");
  });

  it("availability for collection is NOT delivery: DeliveredToPickup stays unverified", () => {
    const s = state({ current: { status: "DeliveredToPickup", at: "2026-09-17T09:24:18Z", source: "shopify_native" } as never });
    expect(resolveShipmentProofType(fulfillment(), s)).toBe("delivered_unverified");
  });

  it("completed delivery with a timestamp outranks transit", () => {
    const s = state({ current: { status: "Delivered", at: "2026-09-18T16:23:00Z", source: "shopify_native" } as never });
    expect(resolveShipmentProofType(fulfillment({ displayStatus: "DELIVERED" }), s)).toBe("delivered_confirmed");
  });

  it("a reconciled return is returned_to_sender, whatever the display status says", () => {
    const s = state({ current: { status: "Returned", at: "2026-07-06T09:40:00Z", source: "carrier_api_dhl" } as never });
    expect(resolveShipmentProofType(fulfillment({ displayStatus: "IN_TRANSIT" }), s)).toBe("returned_to_sender");
  });
});
