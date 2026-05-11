import { describe, it, expect } from "vitest";
import {
  pickInitialRisk,
  pickFulfilledAt,
  pickThreeDsAuthenticated,
  normalizeBackfillOrder,
  type RawBackfillOrder,
  type RawRiskAssessment,
} from "@/lib/shopify/queries/ordersForBackfill";

/**
 * Unit tests for the pure normalization helpers used by the
 * fraud-intelligence backfill. The Shopify schema is verified by
 * runtime contract (the query itself); these tests pin the local
 * derivation rules — particularly the risk-snapshot tie-breaking
 * and the null-tolerance that the immutability trigger depends on.
 */

// Honors explicit `null` overrides (using `??` would mask them).
const rawOrder = (overrides: Partial<RawBackfillOrder> = {}): RawBackfillOrder => {
  const base: RawBackfillOrder = {
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-04-21T10:00:00Z",
    processedAt: "2026-04-21T10:05:00Z",
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "FULFILLED",
    test: false,
    paymentGatewayNames: ["shopify_payments"],
    totalPriceSet: {
      shopMoney: { amount: "120.50", currencyCode: "USD" },
    },
    shippingAddress: { countryCode: "US" },
    fulfillments: null,
    shopifyProtect: null,
    transactions: null,
    risk: null,
  };
  return { ...base, ...overrides };
};

describe("pickInitialRisk", () => {
  it("returns null when no assessments are present", () => {
    expect(pickInitialRisk(null)).toEqual({ level: null, provider: null });
    expect(pickInitialRisk([])).toEqual({ level: null, provider: null });
  });

  it("picks HIGH over MEDIUM over LOW over PENDING over NONE", () => {
    const assessments: RawRiskAssessment[] = [
      { riskLevel: "LOW", provider: { title: "Provider-A" }, facts: null },
      { riskLevel: "HIGH", provider: { title: "Shopify" }, facts: null },
      { riskLevel: "MEDIUM", provider: { title: "Provider-B" }, facts: null },
    ];
    const r = pickInitialRisk(assessments);
    expect(r.level).toBe("HIGH");
    expect(r.provider).toBe("Shopify");
  });

  it("ignores assessments with null riskLevel", () => {
    const assessments: RawRiskAssessment[] = [
      { riskLevel: null, provider: { title: "Junk" }, facts: null },
      { riskLevel: "LOW", provider: { title: "Real" }, facts: null },
    ];
    expect(pickInitialRisk(assessments)).toEqual({ level: "LOW", provider: "Real" });
  });

  it("falls back to 'shopify' when the provider title is missing", () => {
    const assessments: RawRiskAssessment[] = [
      { riskLevel: "MEDIUM", provider: null, facts: null },
    ];
    expect(pickInitialRisk(assessments)).toEqual({
      level: "MEDIUM",
      provider: "shopify",
    });
  });

  it("treats blank provider titles as missing (falls back to 'shopify')", () => {
    const assessments: RawRiskAssessment[] = [
      { riskLevel: "HIGH", provider: { title: "   " }, facts: null },
    ];
    expect(pickInitialRisk(assessments).provider).toBe("shopify");
  });

  it("returns null provider when no level was picked", () => {
    // Every entry has null riskLevel → no winner → provider must be null too.
    const assessments: RawRiskAssessment[] = [
      { riskLevel: null, provider: { title: "A" }, facts: null },
    ];
    expect(pickInitialRisk(assessments)).toEqual({ level: null, provider: null });
  });
});

describe("pickThreeDsAuthenticated", () => {
  it("returns null when no transactions are present", () => {
    expect(pickThreeDsAuthenticated(null)).toBeNull();
    expect(pickThreeDsAuthenticated([])).toBeNull();
  });

  it("returns null for non-Shopify-Payments gateways even if 3DS shape exists", () => {
    // Receipt shape mirrors Stripe's but the gateway is paypal — we
    // refuse to read because the contract isn't ours to trust.
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: {
          card: { three_d_secure: { authenticated: true } },
        },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "paypal", receiptJson: receipt },
      ]),
    ).toBeNull();
  });

  it("returns true when Shopify Payments + modern receipt path is authenticated", () => {
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: {
          card: { three_d_secure: { authenticated: true } },
        },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBe(true);
  });

  it("accepts legacy (non-latest_charge) receipt path as fallback", () => {
    const receipt = JSON.stringify({
      payment_method_details: {
        card: { three_d_secure: { authenticated: true } },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBe(true);
  });

  it("returns null when the receipt parses but no 3DS block is present", () => {
    const receipt = JSON.stringify({ latest_charge: { payment_method_details: { card: {} } } });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBeNull();
  });

  it("returns null when authenticated flag is not strictly true", () => {
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: {
          card: { three_d_secure: { authenticated: false } },
        },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBeNull();
  });

  it("returns null when receiptJson is malformed", () => {
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: "{not-json" },
      ]),
    ).toBeNull();
  });

  it("accepts pre-parsed object receiptJson too", () => {
    const receipt = {
      latest_charge: {
        payment_method_details: {
          card: { three_d_secure: { authenticated: true } },
        },
      },
    };
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBe(true);
  });

  it("ignores transactions that aren't SUCCESS sale/auth", () => {
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: { card: { three_d_secure: { authenticated: true } } },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "REFUND", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
        { kind: "SALE", status: "FAILURE", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBeNull();
  });
});

describe("pickFulfilledAt", () => {
  it("returns null when no fulfillments are present", () => {
    expect(pickFulfilledAt(null)).toBeNull();
    expect(pickFulfilledAt([])).toBeNull();
  });

  it("returns the earliest createdAt across fulfillments", () => {
    expect(
      pickFulfilledAt([
        { createdAt: "2026-04-22T10:00:00Z" },
        { createdAt: "2026-04-21T10:00:00Z" },
        { createdAt: "2026-04-23T10:00:00Z" },
      ]),
    ).toBe("2026-04-21T10:00:00Z");
  });

  it("ignores fulfillments with null createdAt", () => {
    expect(
      pickFulfilledAt([
        { createdAt: null },
        { createdAt: "2026-04-22T10:00:00Z" },
      ]),
    ).toBe("2026-04-22T10:00:00Z");
  });
});

describe("normalizeBackfillOrder", () => {
  const shopId = "11111111-1111-1111-1111-111111111111";

  it("maps required core fields from a happy-path order", () => {
    const { order } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(order.shop_id).toBe(shopId);
    expect(order.shopify_order_id).toBe("gid://shopify/Order/1");
    expect(order.shopify_order_number).toBe("#1001");
    expect(order.currency).toBe("USD");
    expect(order.order_total).toBe(120.5);
    expect(order.financial_status).toBe("PAID");
    expect(order.fulfillment_status).toBe("FULFILLED");
    expect(order.payment_gateway).toBe("shopify_payments");
  });

  it("flags cross-border when shipping country differs from store country", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shippingAddress: { countryCode: "CA" } }),
      { storeCountryCode: "US" },
    );
    expect(order.country).toBe("CA");
    expect(order.is_cross_border).toBe(true);
  });

  it("flags same-country when shipping country matches store country", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shippingAddress: { countryCode: "US" } }),
      { storeCountryCode: "US" },
    );
    expect(order.is_cross_border).toBe(false);
  });

  it("compares country codes case-insensitively", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shippingAddress: { countryCode: "us" } }),
      { storeCountryCode: "US" },
    );
    expect(order.is_cross_border).toBe(false);
  });

  it("leaves is_cross_border null when either side is unknown", () => {
    // No shipping address
    const { order: o1 } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shippingAddress: null }),
      { storeCountryCode: "US" },
    );
    expect(o1.is_cross_border).toBeNull();

    // No store country
    const { order: o2 } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shippingAddress: { countryCode: "DE" } }),
      { storeCountryCode: null },
    );
    expect(o2.is_cross_border).toBeNull();
  });

  it("leaves distance_bucket null in v1 (future-only field)", () => {
    const { order } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(order.distance_bucket).toBeNull();
  });

  it("derives fulfilled_at from the earliest fulfillment createdAt", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({
        fulfillments: [
          { createdAt: "2026-04-22T13:00:00Z", displayStatus: "SUCCESS" },
        ],
      }),
      { storeCountryCode: "US" },
    );
    expect(order.fulfilled_at).toBe("2026-04-22T13:00:00Z");
  });

  it("leaves fulfilled_at null when no fulfillments are present", () => {
    const { order } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(order.fulfilled_at).toBeNull();
  });

  it("captures the immutable risk snapshot when assessments exist", () => {
    const { order, assessments } = normalizeBackfillOrder(
      shopId,
      rawOrder({
        risk: {
          recommendation: "INVESTIGATE",
          assessments: [
            {
              riskLevel: "MEDIUM",
              provider: { title: "Shopify" },
              facts: [
                { description: "Email new", sentiment: "NEGATIVE" },
              ],
            },
            {
              riskLevel: "HIGH",
              provider: { title: "ThirdParty" },
              facts: [{ description: "VPN", sentiment: "NEGATIVE" }],
            },
          ],
        },
      }),
      { storeCountryCode: "US" },
    );
    expect(order.risk_level_initial).toBe("HIGH");
    expect(order.risk_recommendation_initial).toBe("INVESTIGATE");
    expect(order.risk_provider_initial).toBe("ThirdParty");
    expect(assessments).toHaveLength(2);
    expect(assessments[0].provider).toBe("Shopify");
    expect(assessments[1].provider).toBe("ThirdParty");
  });

  it("leaves all three risk_*_initial fields null when no assessments exist", () => {
    // Critical: the immutability trigger relies on the null →
    // first-observed transition. If we ever wrote 'NONE' as a stand-in
    // for "no assessment", later genuine assessments would be rejected.
    const { order } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(order.risk_level_initial).toBeNull();
    expect(order.risk_recommendation_initial).toBeNull();
    expect(order.risk_provider_initial).toBeNull();
  });

  it("captures the Shopify Protect status as fraud_protection_level", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({ shopifyProtect: { status: "PROTECTED" } }),
      { storeCountryCode: "US" },
    );
    expect(order.fraud_protection_level).toBe("PROTECTED");
  });

  it("leaves fraud_protection_level null when Shopify Protect is not applicable", () => {
    const { order } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(order.fraud_protection_level).toBeNull();
  });

  it("falls back to 0 order_total when totalPriceSet is missing", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({ totalPriceSet: null }),
      { storeCountryCode: "US" },
    );
    expect(order.order_total).toBe(0);
    expect(order.currency).toBe("USD");
  });

  it("emits no assessment rows when the order has none", () => {
    const { assessments } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(assessments).toEqual([]);
  });
});
