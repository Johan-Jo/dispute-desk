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
      customerDisplayName: null,
      customerEmail: null,
      status: "needs_response",
      // Canonicalized from the lowercase REST reason to the UPPERCASE enum so
      // it matches the GraphQL path and every disputeTypeLabel lookup.
      reason: "FRAUDULENT",
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
      customerDisplayName: null,
      customerEmail: null,
      status: "needs_response",
      reason: "FRAUDULENT",
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

  it("sanitizes an epoch evidenceDueBy from Shopify to null (no bogus deadline)", () => {
    // Shopify returns evidenceDueBy = Unix epoch (1970-01-01, or 1969-12-31 in a
    // +01:00 tz) for some disputes with no real deadline. It must NOT persist as
    // a "Dec 30" deadline — sanitize to null at ingestion. Regression for the
    // cay-collective import that surfaced 1969-12-31 deadlines.
    const out = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/999",
      type: "INQUIRY",
      status: "NEEDS_RESPONSE",
      reasonDetails: { reason: "fraudulent" },
      amount: { amount: "10.00", currencyCode: "USD" },
      initiatedAt: "2026-05-19T12:00:00Z",
      evidenceDueBy: "1969-12-31T01:00:00+01:00", // = 1970-01-01T00:00:00Z (epoch)
      evidenceSentOn: null,
      finalizedOn: null,
      updatedAt: "2026-05-19T12:00:01Z",
      order: { id: "gid://shopify/Order/1", legacyResourceId: "1", name: "#1" },
    });
    expect(out?.evidenceDueBy).toBeNull();
  });
});

describe("normalizeDisputeWebhookPayload: epoch evidence_due_by", () => {
  it("sanitizes an epoch evidence_due_by to null", () => {
    const out = normalizeDisputeWebhookPayload({
      id: 555,
      amount: "10.00",
      currency: "USD",
      evidence_due_by: "1970-01-01T00:00:00Z",
      evidence_sent_on: null,
      finalized_on: null,
      initiated_at: "2026-05-20T18:30:39Z",
      reason: "fraudulent",
      status: "needs_response",
      type: "chargeback",
    });
    expect(out?.evidenceDueBy).toBeNull();
  });
});

/**
 * Real-payload fixture captured from a production disputes/create delivery
 * (webhook_events row b9edb47e, dispute 10563485753, 2026-05-20). The exact
 * scalar shape Shopify ships — we keep it verbatim so a future Shopify
 * payload shape change is detected as a regression here before it ships.
 */
const REAL_WEBHOOK_PAYLOAD = {
  id: 10563485753,
  // Shopify does NOT include admin_graphql_api_id on the dispute payload.
  // The normalizer MUST synthesize a ShopifyPaymentsDispute GID, NOT a
  // DisputeEvidence one — the latter caused the 2026-05-20 phantom-row
  // incident where the webhook insert split the (shop_id, dispute_gid)
  // unique key from the cron-inserted row.
  amount: "25.93",
  currency: "USD",
  evidence_due_by: "2026-05-27T19:00:00-04:00",
  evidence_sent_on: null,
  finalized_on: null,
  initiated_at: "2026-05-20T18:30:39-04:00",
  network_reason_code: "10.4",
  order_id: 6446376124473,
  reason: "fraudulent",
  status: "needs_response",
  type: "chargeback",
};

describe("regression: real Shopify webhook payload (captured 2026-05-20)", () => {
  it("synthesizes the canonical ShopifyPaymentsDispute GID — NOT DisputeEvidence", () => {
    const out = normalizeDisputeWebhookPayload(REAL_WEBHOOK_PAYLOAD);
    expect(out?.disputeGid).toBe(
      "gid://shopify/ShopifyPaymentsDispute/10563485753",
    );
    // Belt-and-suspenders: explicitly assert it is NOT the entity that
    // caused the 2026-05-20 incident. If a future refactor flips this back,
    // CI will catch it.
    expect(out?.disputeGid).not.toMatch(/DisputeEvidence/);
  });

  it("the webhook-synthesized GID matches what the GraphQL path would emit for the same dispute", () => {
    const webhookSnapshot = normalizeDisputeWebhookPayload(REAL_WEBHOOK_PAYLOAD);
    // What Shopify's `dispute(id:)` query returns as the top-level id.
    const graphqlSnapshot = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/10563485753",
      type: "CHARGEBACK",
      status: "NEEDS_RESPONSE",
      reasonDetails: { reason: "fraudulent" },
    });
    expect(webhookSnapshot?.disputeGid).toBe(graphqlSnapshot?.disputeGid);
  });

  it("normalizer drops fields not in the schema and never returns admin_graphql_api_id back", () => {
    const out = normalizeDisputeWebhookPayload(REAL_WEBHOOK_PAYLOAD);
    expect(out).not.toBeNull();
    // Spot-check: no Shopify-shaped property names should appear on the snapshot.
    const keys = Object.keys(out as unknown as Record<string, unknown>);
    expect(keys).not.toContain("admin_graphql_api_id");
    expect(keys).not.toContain("evidence_due_by"); // we use evidenceDueBy
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

  it("reason casing: webhook lowercase reason is canonicalized to the enum (dispute #12452)", () => {
    // Regression: dispute #12452 arrived live via the REST webhook with
    // reason "credit_not_processed" (lowercase). It was stored raw, so the
    // dashboard's disputeTypeLabel lookup missed and leaked the raw i18n key
    // `packs.disputeTypeLabel.credit_not_processed` into the UI. The webhook
    // path must now emit the same UPPERCASE enum the GraphQL path does.
    const w = normalizeDisputeWebhookPayload({
      id: 12452,
      reason: "credit_not_processed",
      status: "won",
      type: "inquiry",
    });
    expect(w?.reason).toBe("CREDIT_NOT_PROCESSED");

    const g = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/12452",
      reasonDetails: { reason: "CREDIT_NOT_PROCESSED" },
    });
    expect(g?.reason).toBe("CREDIT_NOT_PROCESSED");
  });

  it("reason: genuine null reason is preserved as null, not coerced to GENERAL", () => {
    const w = normalizeDisputeWebhookPayload({ id: 1, status: "won" });
    expect(w?.reason).toBeNull();
    const g = normalizeGraphQLDispute({
      id: "gid://shopify/ShopifyPaymentsDispute/1",
    });
    expect(g?.reason).toBeNull();
  });
});
