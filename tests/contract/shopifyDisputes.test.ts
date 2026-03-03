import { describe, it, expect } from "vitest";
import {
  DisputeListResponseSchema,
  DisputeDetailResponseSchema,
  DisputeEvidenceUpdateResponseSchema,
} from "./schemas";

describe("Shopify GraphQL contract tests (pinned 2026-01)", () => {
  it("validates dispute list response shape", () => {
    const fixture = {
      data: {
        disputes: {
          edges: [
            {
              cursor: "eyJsYXN0X2lkIjo1fQ==",
              node: {
                id: "gid://shopify/ShopifyPaymentsDispute/123456",
                status: "NEEDS_RESPONSE",
                reasonDetails: { reason: "FRAUDULENT" },
                amount: { amount: "49.99", currencyCode: "USD" },
                initiatedAt: "2026-02-20T10:00:00Z",
                evidenceDueBy: "2026-03-05T10:00:00Z",
                order: {
                  id: "gid://shopify/Order/789",
                  name: "#1001",
                },
                disputeEvidence: {
                  id: "gid://shopify/ShopifyPaymentsDisputeEvidence/456",
                },
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: "eyJsYXN0X2lkIjo1fQ==",
          },
        },
      },
    };

    const result = DisputeListResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("validates dispute list with null optional fields", () => {
    const fixture = {
      data: {
        disputes: {
          edges: [
            {
              cursor: "abc",
              node: {
                id: "gid://shopify/ShopifyPaymentsDispute/999",
                status: "WON",
                reasonDetails: null,
                amount: { amount: "10.00", currencyCode: "EUR" },
                initiatedAt: null,
                evidenceDueBy: null,
                order: null,
                disputeEvidence: null,
              },
            },
          ],
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
        },
      },
    };

    const result = DisputeListResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("validates dispute detail response shape", () => {
    const fixture = {
      data: {
        dispute: {
          id: "gid://shopify/ShopifyPaymentsDispute/123456",
          status: "NEEDS_RESPONSE",
          reasonDetails: { reason: "PRODUCT_NOT_RECEIVED" },
          amount: { amount: "120.00", currencyCode: "USD" },
          initiatedAt: "2026-02-10T08:00:00Z",
          evidenceDueBy: "2026-02-25T08:00:00Z",
          order: {
            id: "gid://shopify/Order/789",
            name: "#1001",
            createdAt: "2026-01-15T12:00:00Z",
            totalPriceSet: {
              shopMoney: { amount: "120.00", currencyCode: "USD" },
            },
          },
          disputeEvidence: {
            id: "gid://shopify/ShopifyPaymentsDisputeEvidence/456",
            accessActivityLog: null,
            cancellationPolicyDisclosure: null,
            cancellationRebuttal: null,
            customerCommunication: null,
            refundPolicyDisclosure: "30-day refund policy...",
            refundRefusalExplanation: null,
            shippingDocumentation: "Tracking: 1Z999AA10...",
            uncategorizedText: null,
            customerFirstName: "Jane",
            customerLastName: "D.",
            fulfillments: [
              {
                shippingCarrier: "UPS",
                shippingTrackingNumber: "1Z999AA10",
                shippingTrackingUrl: "https://ups.com/track/1Z999AA10",
                shippingDate: "2026-01-16",
              },
            ],
          },
        },
      },
    };

    const result = DisputeDetailResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("validates disputeEvidenceUpdate response shape", () => {
    const fixture = {
      data: {
        disputeEvidenceUpdate: {
          disputeEvidence: {
            id: "gid://shopify/ShopifyPaymentsDisputeEvidence/456",
          },
          userErrors: [],
        },
      },
    };

    const result = DisputeEvidenceUpdateResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("validates disputeEvidenceUpdate with userErrors", () => {
    const fixture = {
      data: {
        disputeEvidenceUpdate: {
          disputeEvidence: null,
          userErrors: [
            {
              field: ["input", "shippingDocumentation"],
              message: "Field value too long",
            },
          ],
        },
      },
    };

    const result = DisputeEvidenceUpdateResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it("rejects dispute list with invalid GID prefix", () => {
    const fixture = {
      data: {
        disputes: {
          edges: [
            {
              cursor: "abc",
              node: {
                id: "not-a-gid",
                status: "WON",
                reasonDetails: null,
                amount: { amount: "10.00", currencyCode: "EUR" },
                initiatedAt: null,
                evidenceDueBy: null,
                order: null,
                disputeEvidence: null,
              },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };

    const result = DisputeListResponseSchema.safeParse(fixture);
    expect(result.success).toBe(false);
  });
});
