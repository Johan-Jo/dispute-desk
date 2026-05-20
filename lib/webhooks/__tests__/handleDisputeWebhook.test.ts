/**
 * Tests for handleDisputeWebhook (webhook-primary direct processing).
 *
 * The handler is the seam between the HTTP route and the shared engine
 * (`applyDisputeSnapshot`) + dispatcher. We mock the engine, the dispatcher,
 * the idempotency helper, and the HMAC verifier so the test focus stays on
 * the handler's branching contract:
 *
 *   - 401 on HMAC failure
 *   - 400 on missing shop domain (both header and payload)
 *   - 400 on invalid JSON body
 *   - 200 + skipped:"unknown_shop" — Shopify must not retry
 *   - 200 + skipped:"duplicate_event" via Layer A delivery dedup
 *   - 200 + skipped:"schema_validation_failed" + outcome marked
 *     "error_schema_validation" (no retry storm; cron reconciles)
 *   - 200 + outcome:"applied" + dispatcher called on a fresh delivery
 *   - 500 when applyDisputeSnapshot throws — outcome marked "error"
 *   - markProcessed always carries the latency (processingMs)
 *   - The raw body is NEVER stored — only the structured excerpt
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));
vi.mock("@/lib/webhooks/eventIdempotency", () => ({
  checkAndClaim: vi.fn(),
  markProcessed: vi.fn(),
  buildSafePayloadExcerpt: vi.fn(),
}));
vi.mock("@/lib/disputes/applyDisputeSnapshot", () => ({
  applyDisputeSnapshot: vi.fn(),
}));
vi.mock("@/lib/disputes/disputeEffectsDispatcher", () => ({
  dispatchDisputeEffects: vi.fn(),
}));

import { handleDisputeWebhook } from "@/lib/webhooks/handleDisputeWebhook";
import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
} from "@/lib/webhooks/eventIdempotency";
import { applyDisputeSnapshot } from "@/lib/disputes/applyDisputeSnapshot";
import { dispatchDisputeEffects } from "@/lib/disputes/disputeEffectsDispatcher";

const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockGetServiceClient = vi.mocked(getServiceClient);
const mockCheckAndClaim = vi.mocked(checkAndClaim);
const mockMarkProcessed = vi.mocked(markProcessed);
const mockBuildExcerpt = vi.mocked(buildSafePayloadExcerpt);
const mockApply = vi.mocked(applyDisputeSnapshot);
const mockDispatch = vi.mocked(dispatchDisputeEffects);

function setupShopLookup(shop: { id: string } | null) {
  const fromImpl = vi.fn().mockImplementation((table: string) => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: shop, error: null }),
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
}

const RAW_BODY = JSON.stringify({
  id: 12345,
  admin_graphql_api_id: "gid://shopify/DisputeEvidence/12345",
  status: "needs_response",
  myshopify_domain: "demo.myshopify.com",
});

const HEADERS = {
  hmac: "valid-hmac",
  shopDomain: "demo.myshopify.com",
  webhookId: "evt-uuid-1",
  topic: "disputes/create",
};

describe("handleDisputeWebhook (webhook-primary)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildExcerpt.mockReturnValue({ id: 12345, status: "needs_response" });
    mockCheckAndClaim.mockResolvedValue({
      status: "fresh",
      eventRowId: "row-1",
    });
    mockApply.mockResolvedValue({
      outcome: "applied",
      localDisputeId: "dispute-1",
      events: [],
      guardWarnings: [],
      created: false,
    });
    mockDispatch.mockResolvedValue({
      effectsAttempted: 0,
      effectsRan: 0,
      effectsSkipped: 0,
      errors: [],
    });
  });

  it("returns 401 when HMAC verification fails", async () => {
    mockVerify.mockReturnValue(false);
    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });
    expect(r.status).toBe(401);
    expect(mockCheckAndClaim).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid JSON", async () => {
    mockVerify.mockReturnValue(true);
    const r = await handleDisputeWebhook({
      rawBody: "<<not json>>",
      headers: HEADERS,
    });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "Invalid JSON" });
  });

  it("returns 400 when shop domain is missing from both header and payload", async () => {
    mockVerify.mockReturnValue(true);
    const r = await handleDisputeWebhook({
      rawBody: JSON.stringify({ id: 1 }),
      headers: { ...HEADERS, shopDomain: null },
    });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ error: "Missing shop domain" });
  });

  it("returns 200 + skipped:unknown_shop when the shop row is missing (Shopify should not retry)", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup(null);
    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: "unknown_shop" });
    expect(mockCheckAndClaim).not.toHaveBeenCalled();
  });

  it("returns 200 + skipped:duplicate_event via Layer A dedup", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });
    mockCheckAndClaim.mockResolvedValue({
      status: "duplicate",
      eventRowId: null,
    });

    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: "duplicate_event" });
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("normalization failure → 200 + outcome error_schema_validation (no retry storm)", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });

    // Payload missing both id and admin_graphql_api_id — normalizer returns null.
    const r = await handleDisputeWebhook({
      rawBody: JSON.stringify({ status: "needs_response" }),
      headers: HEADERS,
    });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: "schema_validation_failed" });
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "error_schema_validation" }),
    );
  });

  it("happy path: applies snapshot, dispatches effects, marks processed with latency", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });

    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      outcome: "applied",
      disputeId: "dispute-1",
    });
    expect(mockApply).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: "shop-1", source: "webhook" }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ shopId: "shop-1", source: "webhook" }),
    );
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventRowId: "row-1",
        outcome: "applied",
        processingMs: expect.any(Number),
      }),
    );
  });

  /**
   * The "seam" test. Bug 2 from the 2026-05-20 incident: the webhook handler
   * built and tested the GraphQL-backfill hook (fetchDisputeDetail) but never
   * wired it into the applyDisputeSnapshot call. Both sides looked healthy
   * in isolation; the seam between them had no test. This assertion fails
   * loudly if the wiring breaks again.
   */
  it("passes fetchDisputeDetail to applyDisputeSnapshot (the GraphQL backfill seam)", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });

    await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    const applyCall = mockApply.mock.calls[0]?.[0];
    expect(applyCall).toBeDefined();
    expect(typeof applyCall?.fetchDisputeDetail).toBe("function");
  });

  it("apply throws → 500 + outcome marked error (Shopify retries safely)", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });
    mockApply.mockRejectedValue(new Error("transient db error"));

    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(500);
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        errorMessage: expect.stringContaining("transient db error"),
      }),
    );
  });

  it("falls back to a synthetic event id when X-Shopify-Webhook-Id is missing (still claims a row)", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });

    await handleDisputeWebhook({
      rawBody: RAW_BODY,
      headers: { ...HEADERS, webhookId: null },
    });

    const claimCall = mockCheckAndClaim.mock.calls[0]?.[0];
    expect(claimCall?.eventId).toMatch(/^fallback:disputes\/create:/);
  });

  it("passes only the structured excerpt (NOT the raw body) to checkAndClaim", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });

    await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    const claimCall = mockCheckAndClaim.mock.calls[0]?.[0];
    expect(claimCall?.payloadExcerpt).toEqual({
      id: 12345,
      status: "needs_response",
    });
    expect(JSON.stringify(claimCall ?? {})).not.toContain(RAW_BODY);
  });

  it("skipped_stale propagates outcome to markProcessed", async () => {
    mockVerify.mockReturnValue(true);
    setupShopLookup({ id: "shop-1" });
    mockApply.mockResolvedValue({
      outcome: "skipped_stale",
      localDisputeId: "dispute-1",
      events: [],
      guardWarnings: ["stale snapshot"],
      created: false,
    });

    const r = await handleDisputeWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "skipped_stale" });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped_stale" }),
    );
  });
});
