/**
 * Tests for handleOrderWebhook (orders/create + orders/updated).
 *
 * PR-A — verifies the webhook contract:
 *   - 401 on HMAC failure
 *   - 200 + skipped:"unknown_shop" — Shopify must not retry
 *   - 200 + skipped:"duplicate_event" via Layer A delivery dedup
 *   - 200 + outcome:"applied" on a fresh delivery that mutates state
 *   - 200 + outcome:"skipped_unchanged" when persist writer says nothing
 *     moved (the load-bearing assertion for risk_payload_hash dedup)
 *   - 500 when normalizeOrderIngest throws — outcome marked "error"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));
vi.mock("@/lib/webhooks/eventIdempotency", () => ({
  checkAndClaim: vi.fn(),
  markProcessed: vi.fn(),
  buildSafePayloadExcerpt: vi.fn(),
}));
vi.mock("@/lib/shopify/orderIngest", () => ({
  normalizeOrderIngest: vi.fn(),
  resolveShopIdByDomain: vi.fn(),
}));
vi.mock("@/lib/liabilityShift/sessions/ingest", () => ({
  matchSessionToOrder: vi.fn(),
}));

import { handleOrderWebhook } from "@/lib/webhooks/handleOrderWebhook";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import {
  checkAndClaim,
  markProcessed,
  buildSafePayloadExcerpt,
} from "@/lib/webhooks/eventIdempotency";
import {
  normalizeOrderIngest,
  resolveShopIdByDomain,
} from "@/lib/shopify/orderIngest";
import { matchSessionToOrder } from "@/lib/liabilityShift/sessions/ingest";

const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockCheckAndClaim = vi.mocked(checkAndClaim);
const mockMarkProcessed = vi.mocked(markProcessed);
const mockBuildExcerpt = vi.mocked(buildSafePayloadExcerpt);
const mockNormalize = vi.mocked(normalizeOrderIngest);
const mockResolveShop = vi.mocked(resolveShopIdByDomain);
const mockMatchSession = vi.mocked(matchSessionToOrder);

const RAW_BODY = JSON.stringify({
  id: 98765,
  admin_graphql_api_id: "gid://shopify/Order/98765",
  myshopify_domain: "demo.myshopify.com",
});

const HEADERS = {
  hmac: "valid-hmac",
  shopDomain: "demo.myshopify.com",
  webhookId: "evt-uuid-orders-1",
  topic: "orders/create",
};

describe("handleOrderWebhook (PR-A)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildExcerpt.mockReturnValue({ id: 98765 });
    mockCheckAndClaim.mockResolvedValue({
      status: "fresh",
      eventRowId: "row-orders-1",
    });
    mockResolveShop.mockResolvedValue("shop-1");
    mockMatchSession.mockResolvedValue({ matched: true });
    mockNormalize.mockResolvedValue({
      status: "applied",
      persistResult: {
        ordersInserted: 1,
        ordersUpdated: 0,
        assessmentsInserted: 1,
        assessmentsSkippedUnchanged: 0,
      },
    });
  });

  it("returns 401 when HMAC verification fails", async () => {
    mockVerify.mockReturnValue(false);
    const r = await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });
    expect(r.status).toBe(401);
    expect(mockCheckAndClaim).not.toHaveBeenCalled();
  });

  it("returns 200 + skipped:unknown_shop when shop missing (Shopify should not retry)", async () => {
    mockVerify.mockReturnValue(true);
    mockResolveShop.mockResolvedValue(null);
    const r = await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: "unknown_shop" });
    expect(mockCheckAndClaim).not.toHaveBeenCalled();
  });

  it("returns 200 + skipped:duplicate_event via Layer A dedup", async () => {
    mockVerify.mockReturnValue(true);
    mockCheckAndClaim.mockResolvedValue({
      status: "duplicate",
      eventRowId: null,
    });

    const r = await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: "duplicate_event" });
    expect(mockNormalize).not.toHaveBeenCalled();
  });

  it("orders/updated with unchanged risk payload → outcome skipped_unchanged + no assessment row appended", async () => {
    mockVerify.mockReturnValue(true);
    mockNormalize.mockResolvedValue({
      status: "skipped_unchanged",
      persistResult: {
        ordersInserted: 0,
        ordersUpdated: 0,
        assessmentsInserted: 0,
        assessmentsSkippedUnchanged: 1,
      },
    });

    const r = await handleOrderWebhook({
      rawBody: RAW_BODY,
      headers: { ...HEADERS, topic: "orders/updated" },
    });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "skipped_unchanged" });

    // The load-bearing assertion: dedup gate prevented a new
    // shopify_order_risk_assessments row.
    const body = r.body as { persist: { assessmentsInserted: number } };
    expect(body.persist.assessmentsInserted).toBe(0);

    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "skipped_unchanged" }),
    );
  });

  it("happy path: applies + marks processed with latency", async () => {
    mockVerify.mockReturnValue(true);

    const r = await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "applied" });
    expect(mockNormalize).toHaveBeenCalledWith(
      "shop-1",
      "gid://shopify/Order/98765",
      expect.any(Object),
    );
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventRowId: "row-orders-1",
        outcome: "applied",
        processingMs: expect.any(Number),
      }),
    );
  });

  it("normalize throws → 500 + outcome marked error", async () => {
    mockVerify.mockReturnValue(true);
    mockNormalize.mockRejectedValue(new Error("graphql timeout"));

    const r = await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });

    expect(r.status).toBe(500);
    expect(mockMarkProcessed).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "error",
        errorMessage: expect.stringContaining("graphql timeout"),
      }),
    );
  });

  it("falls back to synthetic event id when X-Shopify-Webhook-Id is missing", async () => {
    mockVerify.mockReturnValue(true);

    await handleOrderWebhook({
      rawBody: RAW_BODY,
      headers: { ...HEADERS, webhookId: null },
    });

    const claimCall = mockCheckAndClaim.mock.calls[0]?.[0];
    expect(claimCall?.eventId).toMatch(/^fallback:orders\/create:/);
  });

  // ── LSE-4 session→order match-back ──
  it("links the checkout_session by checkout_token from the REST payload (numeric order id)", async () => {
    mockVerify.mockReturnValue(true);
    const body = JSON.stringify({
      id: 98765,
      admin_graphql_api_id: "gid://shopify/Order/98765",
      myshopify_domain: "demo.myshopify.com",
      // The pixel stores the checkout_token into checkout_sessions.cart_token,
      // so the join key is the order's checkout_token, not its cart_token.
      checkout_token: "chk-abc-123",
      cart_token: "cart-hWNE6-ignored",
      processed_at: "2026-07-04T10:00:00Z",
    });

    await handleOrderWebhook({ rawBody: body, headers: HEADERS });

    expect(mockMatchSession).toHaveBeenCalledWith({
      shopId: "shop-1",
      cartToken: "chk-abc-123", // checkout_token wins over cart_token
      shopifyOrderId: "98765", // numeric, normalized from the gid
      orderPlacedAt: "2026-07-04T10:00:00Z",
    });
  });

  it("falls back to cart_token when checkout_token is absent", async () => {
    mockVerify.mockReturnValue(true);
    const body = JSON.stringify({
      id: 98765,
      admin_graphql_api_id: "gid://shopify/Order/98765",
      myshopify_domain: "demo.myshopify.com",
      cart_token: "cart-only",
    });

    await handleOrderWebhook({ rawBody: body, headers: HEADERS });

    expect(mockMatchSession).toHaveBeenCalledWith(
      expect.objectContaining({ cartToken: "cart-only" }),
    );
  });

  it("does NOT call matchSessionToOrder when the payload has no token", async () => {
    mockVerify.mockReturnValue(true);
    await handleOrderWebhook({ rawBody: RAW_BODY, headers: HEADERS });
    expect(mockMatchSession).not.toHaveBeenCalled();
  });

  it("still applies the order even if the session match-back throws", async () => {
    mockVerify.mockReturnValue(true);
    mockMatchSession.mockRejectedValue(new Error("db down"));
    const body = JSON.stringify({
      id: 98765,
      admin_graphql_api_id: "gid://shopify/Order/98765",
      myshopify_domain: "demo.myshopify.com",
      checkout_token: "chk-xyz",
    });

    const r = await handleOrderWebhook({ rawBody: body, headers: HEADERS });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "applied" });
  });
});
