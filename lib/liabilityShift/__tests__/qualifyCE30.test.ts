/**
 * Tests for the CE 3.0 qualification engine — all three branches plus
 * the gates from EPIC-LSE-1-qualification-engine.md acceptance criteria.
 */

import { describe, it, expect } from "vitest";
import { qualifyCE30 } from "@/lib/liabilityShift/qualifyCE30";
import type {
  CE30Input,
  QualificationOrder,
  ShippingAddressShape,
} from "@/lib/liabilityShift/types";

const shippingMA: ShippingAddressShape = {
  address1: "123 Main St",
  address2: null,
  city: "Boston",
  province: "Massachusetts",
  provinceCode: "MA",
  country: "United States",
  countryCode: "US",
  zip: "02101",
};

function makeOrder(overrides: Partial<QualificationOrder> = {}): QualificationOrder {
  return {
    shopifyOrderId: "gid://shopify/Order/disputed",
    createdAt: "2026-05-01T00:00:00Z",
    customerId: "cust-123",
    customerEmail: "alice@example.com",
    cardNetwork: "visa",
    ipAddress: "203.0.113.5",
    deviceFingerprint: "a".repeat(64),
    shippingAddress: shippingMA,
    subscriptionMarker: null,
    totalAmount: 100,
    totalRefunded: 0,
    disputed: false,
    isValidationCharge: false,
    threeDSecure: null,
    ...overrides,
  };
}

function makePrior(
  daysAgo: number,
  overrides: Partial<QualificationOrder> = {},
): QualificationOrder {
  const created = new Date("2026-05-01T00:00:00Z");
  created.setUTCDate(created.getUTCDate() - daysAgo);
  return makeOrder({
    shopifyOrderId: `gid://shopify/Order/prior-${daysAgo}`,
    createdAt: created.toISOString(),
    ...overrides,
  });
}

function inputFor(
  disputed: QualificationOrder,
  priors: QualificationOrder[],
  extras: Partial<CE30Input> = {},
): CE30Input {
  return {
    disputed,
    networkReasonCode: "10.4",
    priors,
    ...extras,
  };
}

describe("qualifyCE30 — gates", () => {
  it("Mastercard 10.4 → not_applicable (CE 3.0 is Visa-only)", () => {
    const disputed = makeOrder({ cardNetwork: "mastercard" });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.verdict).toBe("not_applicable");
    expect(result.confidenceReasons).toContain("not_applicable:not_visa");
  });

  it("Visa + reason code 13.1 → not_applicable (not a CE 3.0 reason code)", () => {
    const result = qualifyCE30(
      inputFor(makeOrder(), [], { networkReasonCode: "13.1" }),
    );
    expect(result.verdict).toBe("not_applicable");
    expect(result.confidenceReasons[0]).toMatch(/not_applicable:reason_code/);
  });

  it("missing network reason code → not_applicable", () => {
    const result = qualifyCE30(
      inputFor(makeOrder(), [], { networkReasonCode: null }),
    );
    expect(result.verdict).toBe("not_applicable");
  });
});

describe("qualifyCE30 — Branch 1: auto-qualification (Visa Secure / Data Only)", () => {
  it("3DS authenticated (Visa Secure) → qualifies_network_prequalified, skips priors", () => {
    const disputed = makeOrder({
      threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.verdict).toBe("qualifies_network_prequalified");
    expect(result.branch).toBe("auto_qualified");
    expect(result.autoQualificationVia).toBe("visa_secure");
    expect(result.confidence).toBe("high");
  });

  it("3DS authenticated (Data Only) → qualifies_network_prequalified via visa_data_only", () => {
    const disputed = makeOrder({
      threeDSecure: { authenticated: true, dataOnly: true, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.autoQualificationVia).toBe("visa_data_only");
  });

  it("merchant-confirmed 3DS → qualifies via merchant_confirmed", () => {
    const disputed = makeOrder({
      threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: true },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.autoQualificationVia).toBe("merchant_confirmed");
  });

  it("disputed transaction on or after 2026-04-17 → autoQualificationFeeApplies=true", () => {
    const disputed = makeOrder({
      createdAt: "2026-04-17T00:00:00Z",
      threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.autoQualificationFeeApplies).toBe(true);
  });

  it("disputed transaction before 2026-04-17 → autoQualificationFeeApplies=false", () => {
    const disputed = makeOrder({
      createdAt: "2026-04-16T23:59:59Z",
      threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.autoQualificationFeeApplies).toBe(false);
  });

  it("3DS authenticated but on Mastercard → not auto-qualified (gate fails first)", () => {
    const disputed = makeOrder({
      cardNetwork: "mastercard",
      threeDSecure: { authenticated: true, dataOnly: false, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.verdict).toBe("not_applicable");
  });

  it("3DS not authenticated → falls through to standard branch", () => {
    const disputed = makeOrder({
      threeDSecure: { authenticated: false, dataOnly: false, merchantConfirmed: false },
    });
    const result = qualifyCE30(inputFor(disputed, []));
    expect(result.branch).not.toBe("auto_qualified");
  });
});

describe("qualifyCE30 — Branch 3: standard CE 3.0", () => {
  it("3 priors + IP + shipping match across all 3 → qualifies (high confidence)", () => {
    const disputed = makeOrder();
    const priors = [makePrior(150), makePrior(200), makePrior(300)];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("qualifies");
    expect(result.branch).toBe("standard");
    expect(result.matchPoints).toEqual(
      expect.arrayContaining(["ip", "shipping", "account"]),
    );
    expect(result.hasAnchor).toBe(true);
    expect(result.confidence).toBe("high");
  });

  it("matches on shipping + account only → does_not_qualify (no anchor)", () => {
    const disputed = makeOrder({ ipAddress: null, deviceFingerprint: null });
    const priors = [
      makePrior(150, { ipAddress: null, deviceFingerprint: null }),
      makePrior(200, { ipAddress: null, deviceFingerprint: null }),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("does_not_qualify");
    expect(result.confidenceReasons).toContain("no_ip_or_device_anchor");
  });

  it("1 eligible prior → partial (fewer_than_two_priors)", () => {
    const disputed = makeOrder();
    const result = qualifyCE30(inputFor(disputed, [makePrior(150)]));
    expect(result.verdict).toBe("partial");
    expect(result.confidenceReasons).toContain("fewer_than_two_priors");
  });

  it("priors outside 120–365 day window → excluded; no eligible → does_not_qualify", () => {
    const disputed = makeOrder();
    const tooRecent = makePrior(30);
    const tooOld = makePrior(400);
    const result = qualifyCE30(inputFor(disputed, [tooRecent, tooOld]));
    expect(result.verdict).toBe("does_not_qualify");
    expect(result.confidenceReasons).toContain("no_eligible_priors_in_window");
  });

  it("refunded prior excluded", () => {
    const disputed = makeOrder();
    const priors = [
      makePrior(150, { totalRefunded: 100 }),
      makePrior(200),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("partial");
  });

  it("disputed prior excluded", () => {
    const disputed = makeOrder();
    const priors = [makePrior(150, { disputed: true }), makePrior(200)];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("partial");
  });

  it("validation charge prior excluded", () => {
    const disputed = makeOrder();
    const priors = [
      makePrior(150, { isValidationCharge: true }),
      makePrior(200),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("partial");
  });

  it("guest checkout → confidence capped at low", () => {
    const disputed = makeOrder({ customerId: null });
    const priors = [
      makePrior(150, { customerId: null }),
      makePrior(200, { customerId: null }),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("qualifies");
    expect(result.confidence).toBe("low");
    expect(result.confidenceReasons).toContain("guest_checkout");
  });

  it("normalized shipping match → confidence reasons include data-quality warning", () => {
    const disputed = makeOrder();
    const priors = [
      makePrior(150, {
        shippingAddress: { ...shippingMA, address1: "123 Main Street" },
      }),
      makePrior(200, {
        shippingAddress: { ...shippingMA, address1: "123 Main Street" },
      }),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    expect(result.verdict).toBe("qualifies");
    expect(result.confidenceReasons).toContain("shipping_match:normalized_only");
  });

  it("priors don't match across both → partial", () => {
    const disputed = makeOrder();
    // First prior matches everything, second prior matches nothing.
    const priors = [
      makePrior(150),
      makePrior(200, {
        ipAddress: "10.0.0.1",
        deviceFingerprint: "z".repeat(64),
        shippingAddress: {
          ...shippingMA,
          address1: "999 Other Rd",
          city: "Cambridge",
        },
        customerId: "cust-999",
        customerEmail: "other@example.com",
      }),
    ];
    const result = qualifyCE30(inputFor(disputed, priors));
    // No point matches across both, so we expect either partial or does_not_qualify.
    expect(["partial", "does_not_qualify"]).toContain(result.verdict);
  });
});

describe("qualifyCE30 — Branch 2: subscription / initial billing", () => {
  it("subscription order + initial billing matches → qualifies_via_initial_billing", () => {
    const disputed = makeOrder({ subscriptionMarker: "sub-abc" });
    const initialBilling = makePrior(60, { subscriptionMarker: "sub-abc" });
    const result = qualifyCE30(
      inputFor(disputed, [], { initialSubscriptionBilling: initialBilling }),
    );
    expect(result.verdict).toBe("qualifies_via_initial_billing");
    expect(result.branch).toBe("initial_billing");
    expect(result.qualifyingPriors).toEqual([initialBilling.shopifyOrderId]);
  });

  it("subscription order + initial billing has no anchor match → partial", () => {
    const disputed = makeOrder({
      subscriptionMarker: "sub-abc",
      ipAddress: null,
      deviceFingerprint: null,
    });
    const initialBilling = makePrior(60, {
      subscriptionMarker: "sub-abc",
      ipAddress: null,
      deviceFingerprint: null,
    });
    const result = qualifyCE30(
      inputFor(disputed, [], { initialSubscriptionBilling: initialBilling }),
    );
    expect(result.verdict).toBe("partial");
    expect(result.confidenceReasons).toContain("no_ip_or_device_anchor");
  });

  it("subscription order with no initial billing found → falls through to standard branch", () => {
    const disputed = makeOrder({ subscriptionMarker: "sub-abc" });
    const priors = [makePrior(150), makePrior(200)];
    const result = qualifyCE30(inputFor(disputed, priors));
    // Standard branch fires with normal qualification.
    expect(result.branch).toBe("standard");
    expect(result.confidenceReasons).toContain(
      "subscription:no_initial_billing_found",
    );
  });

  it("initial billing branch never goes higher than 'medium' confidence", () => {
    const disputed = makeOrder({ subscriptionMarker: "sub-abc" });
    const initialBilling = makePrior(60, { subscriptionMarker: "sub-abc" });
    const result = qualifyCE30(
      inputFor(disputed, [], { initialSubscriptionBilling: initialBilling }),
    );
    expect(result.confidence === "high").toBe(false);
  });
});
