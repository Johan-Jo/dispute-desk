/**
 * `deliveryStatuses` / `returnedAt` are evidence-hash inputs, not prose
 * material. cay-collective #14784's letter printed the raw enum they carry
 * ("recorded a CollectedAtPickup status event"). Non-receipt plan §6.6.
 */

import { describe, it, expect } from "vitest";
import { stripDeliveryHashInputs } from "../narrativeWriter";

describe("stripDeliveryHashInputs", () => {
  it("drops the hash-only keys from delivery facts and keeps what the letter cites", () => {
    const value = {
      fieldKey: "delivery_proof",
      proofType: "delivered_confirmed",
      carrier: "PostNord SE",
      trackingNumber: "00573132901924649740",
      deliveredAt: "2026-09-18T16:23:00Z",
      deliveryStatuses: ["CollectedAtPickup"],
      returnedAt: null,
    };
    const out = stripDeliveryHashInputs(value);
    expect(out).not.toHaveProperty("deliveryStatuses");
    expect(out).not.toHaveProperty("returnedAt");
    expect(out).toMatchObject({ carrier: "PostNord SE", trackingNumber: "00573132901924649740" });
    // The original (hashed) value is untouched.
    expect(value.deliveryStatuses).toEqual(["CollectedAtPickup"]);
  });

  it("leaves every other field's value untouched", () => {
    const v = { fieldKey: "order_confirmation", deliveryStatuses: ["x"] };
    expect(stripDeliveryHashInputs(v)).toBe(v);
    expect(stripDeliveryHashInputs(null)).toBeNull();
  });
});
