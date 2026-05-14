/**
 * Tests for the Mastercard FPT readiness engine.
 */

import { describe, it, expect } from "vitest";
import { qualifyFPT } from "@/lib/liabilityShift/qualifyFPT";
import type { QualificationOrder } from "@/lib/liabilityShift/types";

function makeOrder(over: Partial<QualificationOrder> = {}): QualificationOrder {
  return {
    shopifyOrderId: "gid://shopify/Order/1",
    createdAt: "2026-05-01T00:00:00Z",
    customerId: "cust-1",
    customerEmail: "a@b.com",
    cardNetwork: "mastercard",
    ipAddress: "1.2.3.4",
    deviceFingerprint: null,
    shippingAddress: {
      address1: "1 A St",
      address2: null,
      city: "Boston",
      province: "MA",
      provinceCode: "MA",
      country: "US",
      countryCode: "US",
      zip: "02101",
    },
    subscriptionMarker: null,
    totalAmount: 100,
    totalRefunded: 0,
    disputed: false,
    isValidationCharge: false,
    threeDSecure: null,
    ...over,
  };
}

describe("qualifyFPT — gates", () => {
  it("Visa card → not_applicable", () => {
    const r = qualifyFPT({
      disputed: makeOrder({ cardNetwork: "visa" }),
      networkReasonCode: "4837",
      shopCountryCode: "US",
    });
    expect(r.verdict).toBe("not_applicable");
    expect(r.confidenceReasons).toContain("not_applicable:not_mastercard");
  });

  it("Mastercard 4855 (not FPT-eligible) → not_applicable", () => {
    const r = qualifyFPT({
      disputed: makeOrder(),
      networkReasonCode: "4855",
      shopCountryCode: "US",
    });
    expect(r.verdict).toBe("not_applicable");
  });

  it("EU region (DE) → not_applicable with region_not_yet_available", () => {
    const r = qualifyFPT({
      disputed: makeOrder(),
      networkReasonCode: "4837",
      shopCountryCode: "DE",
    });
    expect(r.verdict).toBe("not_applicable");
    expect(r.confidenceReasons[0]).toMatch(/region_not_yet_available/);
  });

  it("Brazil + dispute on 2025-05-15 (pre-LATAM launch 2025-06-01) → not_applicable", () => {
    const r = qualifyFPT({
      disputed: makeOrder({ createdAt: "2025-05-15T00:00:00Z" }),
      networkReasonCode: "4837",
      shopCountryCode: "BR",
    });
    expect(r.verdict).toBe("not_applicable");
    expect(r.confidenceReasons[0]).toMatch(/region_pre_launch/);
  });

  it("Brazil + dispute on 2025-07-01 (post-launch) → not not_applicable on region", () => {
    const r = qualifyFPT({
      disputed: makeOrder({ createdAt: "2025-07-01T00:00:00Z" }),
      networkReasonCode: "4837",
      shopCountryCode: "BR",
      customerTenureDays: 200,
      priorOrderCount: 3,
      hasDeliveryConfirmation: true,
    });
    expect(r.verdict).not.toBe("not_applicable");
  });
});

describe("qualifyFPT — scoring", () => {
  it("strong signals across all 3 categories → ready", () => {
    const r = qualifyFPT({
      disputed: makeOrder({
        threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
      }),
      networkReasonCode: "4837",
      shopCountryCode: "US",
      customerTenureDays: 200,
      priorOrderCount: 3,
      hasDeliveryConfirmation: true,
    });
    expect(r.verdict).toBe("ready");
    expect(r.totalScore).toBeGreaterThanOrEqual(2.0);
  });

  it("zero device evidence → partial with device_category_empty", () => {
    const r = qualifyFPT({
      disputed: makeOrder({
        ipAddress: null,
        deviceFingerprint: null,
        threeDSecure: null,
      }),
      networkReasonCode: "4837",
      shopCountryCode: "US",
      customerTenureDays: 200,
      priorOrderCount: 3,
      hasDeliveryConfirmation: true,
    });
    expect(r.verdict).toBe("partial");
    expect(r.missingEvidence).toContain("device_category_empty");
  });

  it("FPT-eligible reason 4863 also qualifies (the 'does not recognize' case)", () => {
    const r = qualifyFPT({
      disputed: makeOrder({
        threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
      }),
      networkReasonCode: "4863",
      shopCountryCode: "US",
      customerTenureDays: 200,
      priorOrderCount: 3,
      hasDeliveryConfirmation: true,
    });
    expect(r.verdict).toBe("ready");
    expect(r.reasonCode).toBe("4863");
  });

  it("all categories present but sum below 2.0 → partial overall_too_weak", () => {
    // Device 0.3 (ip), Delivery 0.3 (address), Identity 0.55 (account + 30d tenure + 1 prior + email) ≈ 1.15
    // Bump identity slightly more to land in the [1.2, 2.0) partial band.
    const r = qualifyFPT({
      disputed: makeOrder({ deviceFingerprint: null, threeDSecure: null }),
      networkReasonCode: "4837",
      shopCountryCode: "US",
      customerTenureDays: 90,
      priorOrderCount: 1,
      hasDeliveryConfirmation: false,
    });
    expect(r.verdict).toBe("partial");
    expect(r.confidenceReasons).toContain("overall_too_weak");
  });
});
