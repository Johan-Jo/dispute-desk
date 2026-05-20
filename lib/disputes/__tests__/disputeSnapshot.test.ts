/**
 * Tests for the shared DisputeSnapshot normalizers.
 *
 * Covers:
 *   - normalizeDisputeWebhookPayload: happy path, missing identifiers, drops
 *     unknown fields, malformed input returns null
 *   - normalizeGraphQLDispute: happy path, malformed input returns null
 *   - parity: webhook + GraphQL representations of the same dispute produce
 *     equivalent snapshots (modulo source-only fields)
 *   - GID synthesis from numeric id when admin_graphql_api_id is absent
 *   - lowercasing of type + status
 */

import { describe, it, expect } from "vitest";
import {
  normalizeDisputeWebhookPayload,
  normalizeGraphQLDispute,
  type DisputeSnapshot,
} from "@/lib/disputes/disputeSnapshot";

describe("normalizeDisputeWebhookPayload", () => {
  it("maps a full REST webhook payload to a DisputeSnapshot", () => {
    const out = normalizeDisputeWebhookPayload({
      id: 12345,
      admin_graphql_api_id: "gid://shopify/ShopifyPaymentsDispute/12345",
      order_id: 9876,
      order_admin_graphql_api_id: "gid://shopify/Order/9876",
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
      reason: "fraudulent",
      network_reason_code: "10.4",
      initiated_at: "2026-05-19T12:00:00Z",
      evidence_due_by: "2026-05-26T12:00:00Z",
      evidence_sent_on: null,
      finalized_on: null,
      amount: "432.90",
      currency: "USD",
      updated_at: "2026-05-19T12:00:01Z",
    });

    expect(out).toEqual<DisputeSnapshot>({
      disputeGid: "gid://shopify/ShopifyPaymentsDispute/12345",
      numericDisputeId: 12345,
      orderGid: "gid://shopify/Order/9876",
      orderId: 9876,
      orderName: null,
      status: "needs_response",
      reason: "fraudulent",
      networkReasonCode: "10.4",
      initiatedAt: "2026-05-19T12:00:00Z",
      evidenceDueBy: "2026-05-26T12:00:00Z",
      evidenceSentOn: null,
      finalizedOn: null,
      amount: "432.90",
      currency: "USD",
      type: "chargeback",
      disputeEvidenceGid: null,
      shopifyUpdatedAt: "2026-05-19T12:00:01Z",
      source: "webhook",
      rawSourceType: "rest_dispute_webhook",
    });
  });

  it("synthesises the dispute GID from numeric id when admin_graphql_api_id is absent", () => {
    const out = normalizeDisputeWebhookPayload({
      id: 4242,
      status: "needs_response",
    });

    expect(out?.disputeGid).toBe("gid://shopify/ShopifyPaymentsDispute/4242");
    expect(out?.numericDisputeId).toBe(4242);
  });

  it("returns null when both id and admin_graphql_api_id are missing", () => {
    const out = normalizeDisputeWebhookPayload({
      status: "needs_response",
      reason: "fraudulent",
    });
    expect(out).toBeNull();
  });

  it("drops unknown payload fields without affecting snapshot shape", () => {
    const out = normalizeDisputeWebhookPayload({
      id: 1,
      status: "won",
      // None of these should appear in the snapshot:
      customer_email: "leak@example.com",
      raw_credit_card: "4242 4242 4242 4242",
      arbitrary_nested: { foo: "bar" },
    });
    expect(out).not.toBeNull();
    expect((out as unknown as Record<string, unknown>).customer_email).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).raw_credit_card).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).arbitrary_nested).toBeUndefined();
  });

  it("returns null on non-object input", () => {
    expect(normalizeDisputeWebhookPayload(null)).toBeNull();
    expect(normalizeDisputeWebhookPayload(undefined)).toBeNull();
    expect(normalizeDisputeWebhookPayload("string")).toBeNull();
    expect(normalizeDisputeWebhookPayload(12)).toBeNull();
  });
});

describe("normalizeGraphQLDispute", () => {
  it("maps a full GraphQL dispute node to a DisputeSnapshot", () => {
    const out = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/12345",
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
      reasonDetails: { reason: "fraudulent" },
      amount: { amount: "432.90", currencyCode: "USD" },
      initiatedAt: "2026-05-19T12:00:00Z",
      evidenceDueBy: "2026-05-26T12:00:00Z",
      evidenceSentOn: null,
      finalizedOn: null,
      updatedAt: "2026-05-19T12:00:01Z",
      order: {
        id: "gid://shopify/Order/9876",
        legacyResourceId: "9876",
        name: "#7079",
      },
      disputeEvidence: {
        id: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
      },
    });

    expect(out).toEqual<DisputeSnapshot>({
      disputeGid: "gid://shopify/ShopifyPaymentsDispute/12345",
      numericDisputeId: "12345",
      orderGid: "gid://shopify/Order/9876",
      orderId: "9876",
      orderName: "#7079",
      status: "needs_response",
      reason: "fraudulent",
      networkReasonCode: null,
      initiatedAt: "2026-05-19T12:00:00Z",
      evidenceDueBy: "2026-05-26T12:00:00Z",
      evidenceSentOn: null,
      finalizedOn: null,
      amount: "432.90",
      currency: "USD",
      type: "chargeback",
      disputeEvidenceGid: "gid://shopify/ShopifyPaymentsDisputeEvidence/777",
      shopifyUpdatedAt: "2026-05-19T12:00:01Z",
      source: "cron",
      rawSourceType: "graphql_dispute",
    });
  });

  it("returns null when the id field is missing (Zod rejects)", () => {
    const out = normalizeGraphQLDispute({
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
    });
    expect(out).toBeNull();
  });

  it("returns null on non-object input", () => {
    expect(normalizeGraphQLDispute(null)).toBeNull();
    expect(normalizeGraphQLDispute("string")).toBeNull();
  });
});

describe("parity: webhook + GraphQL of the same dispute", () => {
  it("produce equivalent snapshots in the diff-relevant fields", () => {
    const webhookSnapshot = normalizeDisputeWebhookPayload({
      id: 12345,
      admin_graphql_api_id: "gid://shopify/ShopifyPaymentsDispute/12345",
      order_admin_graphql_api_id: "gid://shopify/Order/9876",
      order_id: 9876,
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
      reason: "fraudulent",
      initiated_at: "2026-05-19T12:00:00Z",
      evidence_due_by: "2026-05-26T12:00:00Z",
      amount: "432.90",
      currency: "USD",
      updated_at: "2026-05-19T12:00:01Z",
    });

    const graphqlSnapshot = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/12345",
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
      reasonDetails: { reason: "fraudulent" },
      amount: { amount: "432.90", currencyCode: "USD" },
      initiatedAt: "2026-05-19T12:00:00Z",
      evidenceDueBy: "2026-05-26T12:00:00Z",
      order: {
        id: "gid://shopify/Order/9876",
        legacyResourceId: "9876",
      },
      updatedAt: "2026-05-19T12:00:01Z",
    });

    expect(webhookSnapshot).not.toBeNull();
    expect(graphqlSnapshot).not.toBeNull();

    // Diff-relevant fields must match (status, reason, dates, amount, GIDs).
    const diffFields = [
      "disputeGid",
      "orderGid",
      "status",
      "reason",
      "initiatedAt",
      "evidenceDueBy",
      "evidenceSentOn",
      "finalizedOn",
      "amount",
      "currency",
      "type",
      "shopifyUpdatedAt",
    ] as const;

    for (const f of diffFields) {
      expect(
        (webhookSnapshot as unknown as Record<string, unknown>)[f],
        `Field ${f} should match across webhook and GraphQL snapshots`,
      ).toEqual((graphqlSnapshot as unknown as Record<string, unknown>)[f]);
    }

    // Source markers diverge by design.
    expect(webhookSnapshot?.source).toBe("webhook");
    expect(graphqlSnapshot?.source).toBe("cron");
    expect(webhookSnapshot?.rawSourceType).toBe("rest_dispute_webhook");
    expect(graphqlSnapshot?.rawSourceType).toBe("graphql_dispute");
  });

  it("orderId casing: webhook returns number, GraphQL returns string — both surface", () => {
    const w = normalizeDisputeWebhookPayload({
      id: 1,
      order_id: 99,
      admin_graphql_api_id: "gid://shopify/DisputeEvidence/1",
    });
    const g = normalizeGraphQLDispute({
      id: "gid://shopify/DisputeEvidence/1",
      order: { legacyResourceId: "99" },
    });

    expect(w?.orderId).toBe(99);
    expect(g?.orderId).toBe("99");
  });
});
