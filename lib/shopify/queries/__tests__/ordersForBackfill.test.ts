import { describe, it, expect } from "vitest";
import {
  pickInitialRisk,
  pickFulfilledAt,
  pickThreeDsAuthenticated,
  pickPaymentMethod,
  normalizeBackfillOrder,
  normalizeFulfillmentTrackings,
  deriveNativeDelivery,
  flattenTrackingForRow,
  extractNativeSignature,
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
    customer: null,
    fulfillments: null,
    shopifyProtect: null,
    transactions: null,
    metafields: null,
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

  // ── shapes observed LIVE on cay prod (probe 2026-07-19) — the two
  // misses behind the store-wide false-zero. Pinned here so the
  // ingest path can never regress on them again; the walk itself is
  // exhaustively covered in lib/shopify/receipts/__tests__/threeDs.test.ts.

  it("returns true for the OLD charges.data[0] receipt shape (live cay order #1014)", () => {
    const receipt = JSON.stringify({
      charges: {
        data: [
          {
            payment_method_details: {
              card: {
                three_d_secure: {
                  authenticated: true,
                  authentication_flow: "challenge",
                  result: "authenticated",
                  succeeded: true,
                  version: "2.2.0",
                },
              },
            },
          },
        ],
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBe(true);
  });

  it("returns true for the MODERN result-only shape with no authenticated field (live cay order #13812)", () => {
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: {
          card: {
            three_d_secure: {
              authentication_flow: "challenge",
              electronic_commerce_indicator: "02",
              exemption_indicator: null,
              result: "authenticated",
              result_reason: null,
              version: "2.2.0",
            },
          },
        },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBe(true);
  });

  it("returns null for result:'exempted' — an SCA exemption is not an authentication", () => {
    const receipt = JSON.stringify({
      latest_charge: {
        payment_method_details: {
          card: {
            three_d_secure: { result: "exempted", exemption_indicator: "tra" },
          },
        },
      },
    });
    expect(
      pickThreeDsAuthenticated([
        { kind: "SALE", status: "SUCCESS", gateway: "shopify_payments", receiptJson: receipt },
      ]),
    ).toBeNull();
  });
});

describe("pickPaymentMethod", () => {
  it("returns null when no transactions are present", () => {
    expect(pickPaymentMethod(null)).toBeNull();
    expect(pickPaymentMethod([])).toBeNull();
  });

  it("returns the local method name for Klarna/BNPL (the whole point)", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: {
            __typename: "LocalPaymentMethodsPaymentDetails",
            paymentMethodName: "klarna",
          },
        },
      ]),
    ).toBe("klarna");
  });

  it("lower-cases and trims the local method name", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: {
            __typename: "LocalPaymentMethodsPaymentDetails",
            paymentMethodName: "  iDEAL  ",
          },
        },
      ]),
    ).toBe("ideal");
  });

  it("returns the wallet for a card+wallet transaction", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: { __typename: "CardPaymentDetails", wallet: "APPLE_PAY" },
        },
      ]),
    ).toBe("apple_pay");
  });

  it("returns 'card' for a plain card transaction with no wallet", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: { __typename: "CardPaymentDetails", company: "Visa" },
        },
      ]),
    ).toBe("card");
  });

  it("returns null for unknown payment-detail types (never guesses)", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: { __typename: "GiftCardPaymentDetails" },
        },
      ]),
    ).toBeNull();
  });

  it("returns null when the primary transaction has no paymentDetails", () => {
    expect(
      pickPaymentMethod([
        { kind: "SALE", status: "SUCCESS", gateway: "manual", receiptJson: null },
      ]),
    ).toBeNull();
  });

  it("prefers the primary sale/auth transaction over a later refund", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "REFUND",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: { __typename: "CardPaymentDetails", wallet: "GOOGLE_PAY" },
        },
        {
          kind: "SALE",
          status: "SUCCESS",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: {
            __typename: "LocalPaymentMethodsPaymentDetails",
            paymentMethodName: "klarna",
          },
        },
      ]),
    ).toBe("klarna");
  });

  it("falls back to the first transaction when no SUCCESS sale/auth exists", () => {
    expect(
      pickPaymentMethod([
        {
          kind: "SALE",
          status: "FAILURE",
          gateway: "shopify_payments",
          receiptJson: null,
          paymentDetails: { __typename: "CardPaymentDetails", wallet: "APPLE_PAY" },
        },
      ]),
    ).toBe("apple_pay");
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

describe("extractNativeSignature", () => {
  it("pulls a signee name from a 'signed by' event message", () => {
    expect(
      extractNativeSignature([
        { status: "DELIVERED", message: "Delivered, signed by ANNA ANDERSSON" },
      ]),
    ).toBe("ANNA ANDERSSON");
  });

  it("matches 'signed for by' phrasing", () => {
    expect(
      extractNativeSignature([{ status: null, message: "Signed for by J. Smith." }]),
    ).toBe("J. Smith");
  });

  it("returns null when no signature phrasing is present", () => {
    expect(
      extractNativeSignature([{ status: "IN_TRANSIT", message: "Out for delivery" }]),
    ).toBeNull();
    expect(extractNativeSignature(null)).toBeNull();
    expect(extractNativeSignature([])).toBeNull();
  });
});

describe("deriveNativeDelivery", () => {
  it("marks Delivered from native deliveredAt with no tracking app", () => {
    const r = deriveNativeDelivery(
      rawOrder({
        fulfillments: [
          { createdAt: "2026-04-21T10:00:00Z", displayStatus: "DELIVERED", deliveredAt: "2026-04-25T14:00:00Z" },
        ],
      }),
    );
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.deliveredAtTracking).toBe("2026-04-25T14:00:00Z");
    expect(r.signedByName).toBeNull();
  });

  it("falls back to a DELIVERED event happenedAt when deliveredAt is absent", () => {
    const r = deriveNativeDelivery(
      rawOrder({
        fulfillments: [
          {
            createdAt: "2026-04-21T10:00:00Z",
            displayStatus: "OUT_FOR_DELIVERY",
            deliveredAt: null,
            events: {
              edges: [
                { node: { status: "DELIVERED", happenedAt: "2026-04-25T09:30:00Z", message: null } },
              ],
            },
          },
        ],
      }),
    );
    expect(r.deliveryStatus).toBe("Delivered");
    expect(r.deliveredAtTracking).toBe("2026-04-25T09:30:00Z");
  });

  it("extracts the signee from a native delivery event", () => {
    const r = deriveNativeDelivery(
      rawOrder({
        fulfillments: [
          {
            createdAt: "2026-04-21T10:00:00Z",
            displayStatus: "DELIVERED",
            deliveredAt: "2026-04-25T14:00:00Z",
            events: {
              edges: [
                { node: { status: "DELIVERED", happenedAt: "2026-04-25T14:00:00Z", message: "Signed by Erik Larsson" } },
              ],
            },
          },
        ],
      }),
    );
    expect(r.signedByName).toBe("Erik Larsson");
  });

  it("returns nulls for a label-only (undelivered) order", () => {
    const r = deriveNativeDelivery(
      rawOrder({
        fulfillments: [
          { createdAt: "2026-04-21T10:00:00Z", displayStatus: "LABEL_PRINTED", deliveredAt: null },
        ],
      }),
    );
    expect(r).toEqual({ deliveryStatus: null, deliveredAtTracking: null, signedByName: null });
  });
});

describe("flattenTrackingForRow — native fallback", () => {
  it("sources delivery from native fields when no tracking-app metafields exist", () => {
    const row = flattenTrackingForRow(
      rawOrder({
        metafields: null,
        fulfillments: [
          {
            createdAt: "2026-04-21T10:00:00Z",
            displayStatus: "DELIVERED",
            deliveredAt: "2026-04-25T14:00:00Z",
            events: {
              edges: [
                { node: { status: "DELIVERED", happenedAt: "2026-04-25T14:00:00Z", message: "Delivered, signed by Anna Nilsson" } },
              ],
            },
          },
        ],
      }),
    );
    expect(row.delivery_status).toBe("Delivered");
    expect(row.delivered_at_tracking).toBe("2026-04-25T14:00:00Z");
    expect(row.signed_by_name).toBe("Anna Nilsson");
    expect(row.tracking_source).toBe("shopify_native");
  });

  it("leaves all fields null when neither metafields nor native delivery is present", () => {
    const row = flattenTrackingForRow(
      rawOrder({
        metafields: null,
        fulfillments: [
          { createdAt: "2026-04-21T10:00:00Z", displayStatus: "LABEL_PRINTED", deliveredAt: null },
        ],
      }),
    );
    expect(row).toEqual({
      delivery_status: null,
      delivered_at_tracking: null,
      signed_by_name: null,
      tracking_source: null,
    });
  });

  it("prefers a tracking-app metafield source over native when the app supplies status", () => {
    const row = flattenTrackingForRow(
      rawOrder({
        metafields: {
          edges: [
            { node: { namespace: "aftership", key: "tracking_status", value: "Delivered" } },
            { node: { namespace: "aftership", key: "delivered_at", value: "2026-04-24T10:00:00Z" } },
          ],
        },
        fulfillments: [
          { createdAt: "2026-04-21T10:00:00Z", displayStatus: "DELIVERED", deliveredAt: "2026-04-25T14:00:00Z" },
        ],
      }),
    );
    expect(row.tracking_source).toBe("aftership");
    expect(row.delivery_status).toBe("Delivered");
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

  it("derives payment_method from the primary transaction (Klarna vs card)", () => {
    const { order: klarna } = normalizeBackfillOrder(
      shopId,
      rawOrder({
        transactions: [
          {
            kind: "SALE",
            status: "SUCCESS",
            gateway: "shopify_payments",
            receiptJson: null,
            paymentDetails: {
              __typename: "LocalPaymentMethodsPaymentDetails",
              paymentMethodName: "klarna",
            },
          },
        ],
      }),
      { storeCountryCode: "US" },
    );
    // payment_gateway still collapses to shopify_payments; payment_method
    // is what actually distinguishes Klarna.
    expect(klarna.payment_gateway).toBe("shopify_payments");
    expect(klarna.payment_method).toBe("klarna");

    const { order: noTx } = normalizeBackfillOrder(shopId, rawOrder(), {
      storeCountryCode: "US",
    });
    expect(noTx.payment_method).toBeNull();
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

  it("captures customer_email and customer_shopify_id from the customer field (v1.5)", () => {
    const { order } = normalizeBackfillOrder(
      shopId,
      rawOrder({
        customer: {
          id: "gid://shopify/Customer/42",
          email: "buyer@example.com",
        },
      }),
      { storeCountryCode: "US" },
    );
    expect(order.customer_email).toBe("buyer@example.com");
    expect(order.customer_shopify_id).toBe("gid://shopify/Customer/42");
  });

  it("leaves customer columns null on guest checkouts (customer field null)", () => {
    const { order } = normalizeBackfillOrder(shopId, rawOrder({ customer: null }), {
      storeCountryCode: "US",
    });
    expect(order.customer_email).toBeNull();
    expect(order.customer_shopify_id).toBeNull();
  });

  it("tolerates partial customer payloads (id or email missing individually)", () => {
    const { order: emailOnly } = normalizeBackfillOrder(
      shopId,
      rawOrder({ customer: { id: null, email: "anon@example.com" } }),
      { storeCountryCode: "US" },
    );
    expect(emailOnly.customer_email).toBe("anon@example.com");
    expect(emailOnly.customer_shopify_id).toBeNull();

    const { order: gidOnly } = normalizeBackfillOrder(
      shopId,
      rawOrder({ customer: { id: "gid://shopify/Customer/99", email: null } }),
      { storeCountryCode: "US" },
    );
    expect(gidOnly.customer_email).toBeNull();
    expect(gidOnly.customer_shopify_id).toBe("gid://shopify/Customer/99");
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

describe("normalizeFulfillmentTrackings", () => {
  const F1 = "gid://shopify/Fulfillment/11";
  const F2 = "gid://shopify/Fulfillment/22";

  it("emits one row per (fulfillment, tracking entry), preserving the relationship", () => {
    const raw = rawOrder({
      fulfillments: [
        {
          id: F1,
          createdAt: "2026-05-01T08:00:00Z",
          displayStatus: "DELIVERED",
          deliveredAt: "2026-05-05T12:00:00Z",
          trackingInfo: [
            { company: "PostNord SE", number: "PN123", url: "https://tracking.postnord.com/?id=PN123" },
          ],
        },
        {
          id: F2,
          createdAt: "2026-05-02T08:00:00Z",
          displayStatus: "IN_TRANSIT",
          trackingInfo: [
            { company: "DHL Freight", number: "5198980574", url: "https://www.dhl.com/se-en/home/tracking.html?tracking-id=373325386394209542" },
          ],
        },
      ],
    });
    const rows = normalizeFulfillmentTrackings("shop-1", raw);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      shop_id: "shop-1",
      shopify_order_id: "gid://shopify/Order/1",
      shopify_fulfillment_id: F1,
      company_raw: "PostNord SE",
      tracking_number: "PN123",
      tracking_key: "PN123",
      shipment_status: "Delivered",
      terminal_at: "2026-05-05T12:00:00Z",
      tracking_source: "shopify_native",
    });
    expect(rows[1]).toMatchObject({
      shopify_fulfillment_id: F2,
      company_raw: "DHL Freight",
      tracking_number: "5198980574",
      shipment_status: null,
      terminal_at: null,
      tracking_source: null,
    });
  });

  it("dedupes identical tracking entries within a fulfillment", () => {
    const raw = rawOrder({
      fulfillments: [
        {
          id: F1,
          createdAt: null,
          displayStatus: null,
          trackingInfo: [
            { company: "DHL", number: "N1", url: "https://dhl.example/a" },
            { company: "DHL", number: "N1", url: "https://dhl.example/a" },
            { company: "DHL", number: "N2", url: null },
          ],
        },
      ],
    });
    const rows = normalizeFulfillmentTrackings("shop-1", raw);
    expect(rows.map((r) => r.tracking_key)).toEqual(["N1", "N2"]);
  });

  it("keys on the URL when the number is missing", () => {
    const raw = rawOrder({
      fulfillments: [
        {
          id: F1,
          createdAt: null,
          displayStatus: null,
          trackingInfo: [{ company: "GLS", number: null, url: "https://gls.example/t/42" }],
        },
      ],
    });
    const rows = normalizeFulfillmentTrackings("shop-1", raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].tracking_number).toBeNull();
    expect(rows[0].tracking_key).toBe("https://gls.example/t/42");
  });

  it("emits a trackingless row (empty key) so classification is still persisted", () => {
    const raw = rawOrder({
      fulfillments: [
        {
          id: F1,
          createdAt: null,
          displayStatus: "DELIVERED",
          trackingInfo: [],
          events: {
            edges: [
              {
                node: {
                  status: "DELIVERED",
                  happenedAt: "2026-05-06T10:00:00Z",
                  message: "Delivered to recipient",
                },
              },
            ],
          },
        },
      ],
    });
    const rows = normalizeFulfillmentTrackings("shop-1", raw);
    expect(rows).toHaveLength(1);
    expect(rows[0].tracking_key).toBe("");
    expect(rows[0].shipment_status).toBe("Delivered");
  });

  it("classifies per shipment, NOT collapsed to the order's best signal", () => {
    const raw = rawOrder({
      fulfillments: [
        {
          id: F1,
          createdAt: null,
          displayStatus: null,
          trackingInfo: [{ company: "Bring", number: "B1", url: null }],
          events: {
            edges: [
              {
                node: {
                  status: "DELIVERED",
                  happenedAt: "2026-05-06T10:00:00Z",
                  message: "Delivered to recipient",
                },
              },
            ],
          },
        },
        {
          id: F2,
          createdAt: null,
          displayStatus: null,
          trackingInfo: [{ company: "Bring", number: "B2", url: null }],
          events: {
            edges: [
              {
                node: {
                  status: "FAILURE",
                  happenedAt: "2026-05-07T10:00:00Z",
                  message: "Returned to sender",
                },
              },
            ],
          },
        },
      ],
    });
    const rows = normalizeFulfillmentTrackings("shop-1", raw);
    expect(rows.find((r) => r.tracking_key === "B1")?.shipment_status).toBe("Delivered");
    expect(rows.find((r) => r.tracking_key === "B2")?.shipment_status).toBe("Returned");
  });

  it("skips fulfillments without an id and orders without fulfillments", () => {
    expect(normalizeFulfillmentTrackings("shop-1", rawOrder())).toEqual([]);
    const raw = rawOrder({
      fulfillments: [
        {
          createdAt: null,
          displayStatus: null,
          trackingInfo: [{ company: "DHL", number: "X", url: null }],
        },
      ],
    });
    expect(normalizeFulfillmentTrackings("shop-1", raw)).toEqual([]);
  });
});
