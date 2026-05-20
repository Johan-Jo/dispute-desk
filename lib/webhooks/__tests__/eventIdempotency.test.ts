/**
 * Tests for the webhook delivery idempotency helper (Layer A).
 *
 * Covers:
 *   - checkAndClaim returns "fresh" on first insert
 *   - checkAndClaim returns "duplicate" on Postgres unique-violation (code 23505)
 *   - per-(shop_id, event_id) scoping — same event_id under a different shop
 *     is still fresh
 *   - markProcessed writes outcome + processing_ms + processed_at
 *   - buildSafePayloadExcerpt drops fields outside the allowlist and rejects
 *     nested objects (defense against shape drift)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
} from "@/lib/webhooks/eventIdempotency";
import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

type InsertResolved = {
  data: { id: string } | null;
  error: { code?: string; message?: string } | null;
};

function makeInsertChain(resolved: InsertResolved) {
  const single = vi.fn().mockResolvedValue(resolved);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return { insert, select, single };
}

function makeUpdateChain(resolved: { error: { message?: string } | null }) {
  const eq = vi.fn().mockResolvedValue(resolved);
  const update = vi.fn().mockReturnValue({ eq });
  return { update, eq };
}

describe("eventIdempotency.checkAndClaim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns fresh + eventRowId when the insert succeeds", async () => {
    const { insert } = makeInsertChain({
      data: { id: "row-1" },
      error: null,
    });
    const from = vi.fn().mockReturnValue({ insert });
    mockGetServiceClient.mockReturnValue({ from } as never);

    const result = await checkAndClaim({
      shopId: "shop-1",
      eventId: "evt-1",
      topic: "disputes/create",
      shopifyObjectId: "gid://shopify/DisputeEvidence/1",
      payloadExcerpt: { id: 1, status: "needs_response" },
    });

    expect(result).toEqual({ status: "fresh", eventRowId: "row-1" });
    expect(from).toHaveBeenCalledWith("webhook_events");
    expect(insert).toHaveBeenCalledWith({
      shop_id: "shop-1",
      event_id: "evt-1",
      topic: "disputes/create",
      shopify_object_id: "gid://shopify/DisputeEvidence/1",
      payload_excerpt: { id: 1, status: "needs_response" },
    });
  });

  it("returns duplicate on Postgres unique-violation (code 23505)", async () => {
    const { insert } = makeInsertChain({
      data: null,
      error: { code: "23505", message: "duplicate key value" },
    });
    const from = vi.fn().mockReturnValue({ insert });
    mockGetServiceClient.mockReturnValue({ from } as never);

    const result = await checkAndClaim({
      shopId: "shop-1",
      eventId: "evt-1",
      topic: "disputes/update",
    });

    expect(result).toEqual({ status: "duplicate", eventRowId: null });
  });

  it("throws on non-uniqueness DB errors so the caller treats them as 500", async () => {
    const { insert } = makeInsertChain({
      data: null,
      error: { code: "08000", message: "connection failure" },
    });
    const from = vi.fn().mockReturnValue({ insert });
    mockGetServiceClient.mockReturnValue({ from } as never);

    await expect(
      checkAndClaim({
        shopId: "shop-1",
        eventId: "evt-99",
        topic: "disputes/create",
      }),
    ).rejects.toThrow(/connection failure/);
  });

  it("scopes the unique constraint per shop — same event_id under different shops is independent", async () => {
    // First shop: fresh insert succeeds.
    const chainA = makeInsertChain({ data: { id: "row-a" }, error: null });
    // Second shop: also fresh — different shop_id, so no constraint collision.
    const chainB = makeInsertChain({ data: { id: "row-b" }, error: null });

    const insertImpls = [chainA.insert, chainB.insert];
    let callIdx = 0;
    const from = vi.fn().mockImplementation(() => ({
      insert: (...args: unknown[]) => {
        const impl = insertImpls[callIdx++];
        return (impl as unknown as (...a: unknown[]) => unknown)(...args);
      },
    }));
    mockGetServiceClient.mockReturnValue({ from } as never);

    const r1 = await checkAndClaim({
      shopId: "shop-a",
      eventId: "shared-evt",
      topic: "disputes/create",
    });
    const r2 = await checkAndClaim({
      shopId: "shop-b",
      eventId: "shared-evt",
      topic: "disputes/create",
    });

    expect(r1).toEqual({ status: "fresh", eventRowId: "row-a" });
    expect(r2).toEqual({ status: "fresh", eventRowId: "row-b" });
    expect(chainA.insert).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: "shop-a" }),
    );
    expect(chainB.insert).toHaveBeenCalledWith(
      expect.objectContaining({ shop_id: "shop-b" }),
    );
  });
});

describe("eventIdempotency.markProcessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes processed_at, outcome, processing_ms, error_message onto the row", async () => {
    const { update, eq } = makeUpdateChain({ error: null });
    const from = vi.fn().mockReturnValue({ update });
    mockGetServiceClient.mockReturnValue({ from } as never);

    await markProcessed({
      eventRowId: "row-1",
      outcome: "applied",
      processingMs: 142,
    });

    expect(from).toHaveBeenCalledWith("webhook_events");
    const updateArg = update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(updateArg).toMatchObject({
      outcome: "applied",
      processing_ms: 142,
      error_message: null,
    });
    expect(typeof updateArg.processed_at).toBe("string");
    expect(eq).toHaveBeenCalledWith("id", "row-1");
  });

  it("does not throw when the UPDATE errors (orphan rows are surfaced via /admin/webhooks instead)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { update } = makeUpdateChain({
      error: { message: "row gone" },
    });
    const from = vi.fn().mockReturnValue({ update });
    mockGetServiceClient.mockReturnValue({ from } as never);

    await expect(
      markProcessed({
        eventRowId: "row-x",
        outcome: "error",
        processingMs: 1,
        errorMessage: "boom",
      }),
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("eventIdempotency.buildSafePayloadExcerpt", () => {
  it("keeps allowlisted scalar fields", () => {
    const out = buildSafePayloadExcerpt({
      id: 12345,
      admin_graphql_api_id: "gid://shopify/DisputeEvidence/12345",
      status: "needs_response",
      reason: "fraudulent",
      network_reason_code: "10.4",
      initiated_at: "2026-05-19T12:00:00Z",
      evidence_due_by: "2026-05-26T12:00:00Z",
      evidence_sent_on: null,
      finalized_on: null,
      amount: "432.90",
      currency: "USD",
      type: "CHARGEBACK",
      order_id: 9876,
      order_admin_graphql_api_id: "gid://shopify/Order/9876",
    });

    expect(out).toMatchObject({
      id: 12345,
      status: "needs_response",
      reason: "fraudulent",
      amount: "432.90",
    });
    expect(Object.keys(out ?? {})).toHaveLength(14);
  });

  it("drops fields outside the allowlist (PII-defense)", () => {
    const out = buildSafePayloadExcerpt({
      id: 1,
      status: "needs_response",
      // None of these are on the allowlist — must all be dropped.
      customer_email: "leak@example.com",
      customer_first_name: "Jane",
      customer_last_name: "Doe",
      billing_address: { city: "Springfield" },
      shipping_address: { city: "Springfield" },
      raw_credit_card: "4242 4242 4242 4242",
    });

    expect(out).toEqual({ id: 1, status: "needs_response" });
  });

  it("drops nested objects on allowlisted keys (shape-drift defense)", () => {
    const out = buildSafePayloadExcerpt({
      id: 1,
      // If Shopify ever wraps amount in an object — drop it. We only persist scalars.
      amount: { value: "100", currency: "USD" },
      status: "needs_response",
    });

    expect(out).toEqual({ id: 1, status: "needs_response" });
  });

  it("returns null for non-object input", () => {
    expect(buildSafePayloadExcerpt(null)).toBeNull();
    expect(buildSafePayloadExcerpt(undefined)).toBeNull();
    expect(buildSafePayloadExcerpt("string")).toBeNull();
    expect(buildSafePayloadExcerpt([1, 2, 3])).toBeNull();
  });

  it("returns null when no allowlisted fields are present", () => {
    const out = buildSafePayloadExcerpt({
      customer_email: "leak@example.com",
      raw_html_body: "<html>",
    });
    expect(out).toBeNull();
  });
});
