import { describe, it, expect } from "vitest";
import { buildSignalRow } from "@/lib/fraudIntel/signalWriter";
import type { RawBackfillOrder } from "@/lib/shopify/queries/ordersForBackfill";

function rawOrder(
  overrides: Partial<RawBackfillOrder> = {},
): RawBackfillOrder {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    createdAt: "2026-05-20T12:00:00Z",
    processedAt: "2026-05-20T12:00:01Z",
    cancelledAt: null,
    cancelReason: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    test: false,
    paymentGatewayNames: ["shopify_payments"],
    clientIp: null,
    totalPriceSet: {
      shopMoney: { amount: "100.00", currencyCode: "USD" },
    },
    shippingAddress: { countryCode: "US" },
    billingAddress: { countryCode: "US", zip: "94110" },
    customer: { id: null, email: null },
    fulfillments: null,
    shopifyProtect: null,
    transactions: null,
    metafields: null,
    risk: null,
    ...overrides,
  };
}

describe("buildSignalRow — structured-over-parsed precedence (load-bearing)", () => {
  it("picks AVS / CVV / BIN / brand / wallet from GraphQL paymentDetails", () => {
    const { row } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({
        transactions: [
          {
            kind: "SALE",
            status: "SUCCESS",
            gateway: "shopify_payments",
            receiptJson: null,
            paymentDetails: {
              __typename: "CardPaymentDetails",
              avsResultCode: "Y",
              cvvResultCode: "M",
              bin: "424242",
              company: "VISA",
              wallet: "apple_pay",
            },
          },
        ],
      }),
    });

    expect(row.avs_address_result).toBe("Y");
    expect(row.avs_zip_result).toBe("Y");
    expect(row.cvv_result).toBe("M");
    expect(row.card_bin).toBe("424242");
    expect(row.card_brand).toBe("VISA");
    expect(row.wallet_type).toBe("apple_pay");
  });

  it("captures clientIp from the GraphQL field", () => {
    const { row } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({ clientIp: "203.0.113.42" }),
    });
    expect(row.client_ip).toBe("203.0.113.42");
  });

  it("leaves card fields NULL on wallet checkouts (paymentDetails not CardPaymentDetails)", () => {
    const { row } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({
        transactions: [
          {
            kind: "SALE",
            status: "SUCCESS",
            gateway: "shop_pay",
            receiptJson: null,
            // Base PaymentDetails interface — no card-specific fields.
            paymentDetails: { __typename: "ShopPayInstallmentsPaymentDetails" },
          },
        ],
      }),
    });
    expect(row.avs_address_result).toBeNull();
    expect(row.cvv_result).toBeNull();
    expect(row.card_bin).toBeNull();
    expect(row.card_brand).toBeNull();
    expect(row.wallet_type).toBeNull();
  });

  it("parses proxy_detected from risk facts when sentiment matches", () => {
    const { row } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({
        risk: {
          recommendation: "INVESTIGATE",
          assessments: [
            {
              riskLevel: "HIGH",
              provider: { title: "shopify" },
              facts: [
                {
                  description: "Customer IP came from a proxy",
                  sentiment: "NEGATIVE",
                },
              ],
            },
          ],
        },
      }),
    });
    expect(row.proxy_detected).toBe(true);
  });

  it("sets parse_miss_reason='unmatched_phrases' when facts are present but parser misses all of them", () => {
    const { row, misses } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({
        risk: {
          recommendation: "INVESTIGATE",
          assessments: [
            {
              riskLevel: "MEDIUM",
              provider: { title: "shopify" },
              facts: [
                {
                  description: "A Shopify phrasing we have never seen",
                  sentiment: "NEUTRAL",
                },
              ],
            },
          ],
        },
      }),
    });
    expect(row.parse_miss_reason).toBe("unmatched_phrases");
    expect(misses.length).toBe(1);
  });

  it("parse_miss_reason is NULL when no facts at all (data genuinely absent)", () => {
    const { row, misses } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder({ risk: null }),
    });
    expect(row.parse_miss_reason).toBeNull();
    expect(misses.length).toBe(0);
  });

  it("provenance fields are persisted", () => {
    const { row } = buildSignalRow({
      shopId: "shop-1",
      shopifyOrderId: "gid://shopify/Order/1",
      raw: rawOrder(),
      sourceAssessmentId: "assess-uuid-1",
      sourceAssessmentCreatedAt: "2026-05-20T12:00:00Z",
    });
    expect(row.source_assessment_id).toBe("assess-uuid-1");
    expect(row.source_assessment_created_at).toBe("2026-05-20T12:00:00Z");
    expect(row.parser_version).toBeGreaterThanOrEqual(1);
  });
});
