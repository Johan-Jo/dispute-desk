/**
 * Tests for POST /api/webhooks/app-subscriptions-update.
 *
 * The handler is intentionally thin — HMAC + shop lookup + audit +
 * forward to `reconcileBillingCycleForShop`. The state-machine logic
 * (status mapping, credit grant, idempotency) lives in the reconciler
 * and is covered by its own test file. Here we assert:
 *
 *   1. HMAC failure → 401, no DB writes, no reconciler call.
 *   2. Missing X-Shopify-Shop-Domain header → 400.
 *   3. Unknown shop → 200 + ignored="unknown_shop", no reconciler call.
 *   4. Uninstalled shop → 200 + ignored="uninstalled_shop", no
 *      reconciler call (PRD asymmetry: cancelled ≠ uninstalled).
 *   5. Valid payload → reconciler is called with the resolved shop_id,
 *      audit row written before reconciler runs (so a reconciler
 *      failure does not erase evidence the webhook landed).
 *   6. Reconciler failure → 500 with diagnostic body, audit still
 *      written.
 *   7. Malformed JSON body (HMAC still passed) → audit fields are
 *      null but the reconciler still runs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));
vi.mock("@/lib/billing/reconcileBillingCycle", () => ({
  reconcileBillingCycleForShop: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { reconcileBillingCycleForShop } from "@/lib/billing/reconcileBillingCycle";
import { POST } from "@/app/api/webhooks/app-subscriptions-update/route";

const mockGetClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockReconcile = vi.mocked(reconcileBillingCycleForShop);

interface SbCapture {
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

function buildSb(args: {
  shopRow: { id: string; uninstalled_at: string | null } | null;
  capture: SbCapture;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "shops") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: args.shopRow,
            error: args.shopRow ? null : { message: "not found" },
          }),
        };
      }
      if (table === "audit_events") {
        return {
          insert: vi.fn().mockImplementation(async (row) => {
            args.capture.inserts.push({ table, row });
            return { data: null, error: null };
          }),
        };
      }
      return {} as never;
    }),
  };
}

function makeReq(opts: {
  body?: unknown;
  rawBody?: string;
  hmac?: string;
  shopDomain?: string;
}): NextRequest {
  const url = new URL(
    "http://localhost/api/webhooks/app-subscriptions-update",
  );
  const raw =
    opts.rawBody ??
    JSON.stringify(
      opts.body ?? {
        app_subscription: {
          admin_graphql_api_id: "gid://shopify/AppSubscription/100",
          status: "ACTIVE",
          current_period_end: "2026-07-01T00:00:00Z",
        },
      },
    );
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-shopify-hmac-sha256": opts.hmac ?? "valid",
      "x-shopify-shop-domain": opts.shopDomain ?? "demo.myshopify.com",
      "content-type": "application/json",
    },
    body: raw,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/webhooks/app-subscriptions-update", () => {
  it("rejects with 401 when HMAC verification fails (no DB writes)", async () => {
    mockVerify.mockReturnValue(false);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );

    const res = await POST(makeReq({ hmac: "bad" }));
    expect(res.status).toBe(401);
    expect(mockReconcile).not.toHaveBeenCalled();
    expect(capture.inserts).toHaveLength(0);
  });

  it("returns 400 when X-Shopify-Shop-Domain header is missing", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );

    const res = await POST(makeReq({ shopDomain: "" }));
    expect(res.status).toBe(400);
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("ignores unknown shop with 200 (no reconciler call)", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({ shopRow: null, capture }) as never,
    );

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe("unknown_shop");
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("ignores uninstalled shop with 200 (cancelled ≠ uninstalled invariant)", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: "2026-04-01T00:00:00Z" },
        capture,
      }) as never,
    );

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ignored).toBe("uninstalled_shop");
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("valid payload forwards to reconciler with resolved shop_id", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );
    mockReconcile.mockResolvedValue({
      ok: true,
      action: "credits_granted",
      state: "active",
      packs: 75,
      cycleEndIso: "2026-07-01T00:00:00Z",
    });

    const res = await POST(makeReq({}));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.outcome).toMatchObject({
      action: "credits_granted",
      packs: 75,
    });
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    expect(mockReconcile.mock.calls[0][0]).toEqual({ shopId: "shop-1" });

    // Audit row written with payload diagnostics.
    expect(capture.inserts).toHaveLength(1);
    const audit = capture.inserts[0].row as {
      event_type: string;
      event_payload: Record<string, unknown>;
    };
    expect(audit.event_type).toBe("app_subscription_update_received");
    expect(audit.event_payload.payload_status).toBe("ACTIVE");
    expect(audit.event_payload.payload_subscription_gid).toBe(
      "gid://shopify/AppSubscription/100",
    );
  });

  it("reconciler failure returns 500 but audit row was already written", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );
    mockReconcile.mockRejectedValue(new Error("supabase blew up"));

    const res = await POST(makeReq({}));
    expect(res.status).toBe(500);
    // Audit was still written before the reconciler call.
    expect(capture.inserts).toHaveLength(1);
    expect(capture.inserts[0].row).toMatchObject({
      event_type: "app_subscription_update_received",
    });
  });

  it("does not trust the payload status — reconciler is the source of truth", async () => {
    // Even if the payload claims ACTIVE, the reconciler may resolve
    // to expired (e.g. live Shopify says no active subscription).
    // The handler must forward without short-circuiting.
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );
    mockReconcile.mockResolvedValue({
      ok: true,
      action: "state_transition",
      from: "active",
      to: "expired",
    });

    const res = await POST(
      makeReq({
        body: {
          app_subscription: {
            admin_graphql_api_id: "gid://shopify/AppSubscription/100",
            status: "ACTIVE", // lie
            current_period_end: "2026-07-01T00:00:00Z",
          },
        },
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toMatchObject({
      action: "state_transition",
      to: "expired",
    });
  });

  it("malformed JSON still triggers the reconciler — audit fields null", async () => {
    mockVerify.mockReturnValue(true);
    const capture: SbCapture = { inserts: [] };
    mockGetClient.mockReturnValue(
      buildSb({
        shopRow: { id: "shop-1", uninstalled_at: null },
        capture,
      }) as never,
    );
    mockReconcile.mockResolvedValue({
      ok: true,
      action: "no_change",
      state: "active",
    });

    const res = await POST(makeReq({ rawBody: "{ not json" }));
    expect(res.status).toBe(200);
    expect(mockReconcile).toHaveBeenCalledTimes(1);
    const audit = capture.inserts[0].row as {
      event_payload: { payload_status: string | null };
    };
    expect(audit.event_payload.payload_status).toBeNull();
  });
});
