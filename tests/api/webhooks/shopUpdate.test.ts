/**
 * Tests for POST /api/webhooks/shop-update.
 *
 * Mocks HMAC verification, the Supabase client, the session loader,
 * and the dispute webhook re-registration. Covers:
 *   - 401 when HMAC verification fails (no DB writes)
 *   - 400 when myshopify_domain is missing from the payload
 *   - 200 happy path: bumps shops.updated_at and re-registers dispute
 *     webhooks when an offline session exists
 *   - 200 happy path: skips registration when no offline session exists
 *     (still updates the shop row)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));
vi.mock("@/lib/shopify/sessionStorage", () => ({
  loadSession: vi.fn(),
}));
vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { loadSession } from "@/lib/shopify/sessionStorage";
import { registerDisputeWebhooks } from "@/lib/shopify/registerDisputeWebhooks";
import { POST } from "@/app/api/webhooks/shop-update/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);
const mockLoadSession = vi.mocked(loadSession);
const mockRegister = vi.mocked(registerDisputeWebhooks);

interface SupabaseSpies {
  shopsUpdate: ReturnType<typeof vi.fn>;
}

function setupSupabase(opts: { shopRow?: { id: string } | null }): SupabaseSpies {
  const shopsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: opts.shopRow ?? null,
          error: null,
        }),
        update: shopsUpdate,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
  return { shopsUpdate };
}

function makeReq(body: string, hmac: string | null = "ok-hmac") {
  const headers: Record<string, string> = {};
  if (hmac !== null) headers["x-shopify-hmac-sha256"] = hmac;
  return new NextRequest("http://localhost/api/webhooks/shop-update", {
    method: "POST",
    body,
    headers,
  });
}

const PAYLOAD = JSON.stringify({
  id: 999,
  myshopify_domain: "demo.myshopify.com",
});

describe("POST /api/webhooks/shop-update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegister.mockResolvedValue({ ok: true, errors: [] } as never);
  });

  it("returns 401 when HMAC verification fails (no DB writes)", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq(PAYLOAD, "bad-hmac"));

    expect(res.status).toBe(401);
    expect(spies.shopsUpdate).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("returns 400 when myshopify_domain is missing from the payload", async () => {
    mockVerify.mockReturnValue(true);
    setupSupabase({ shopRow: null });

    const res = await POST(makeReq("{}"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing shop domain");
  });

  it("happy path: bumps shops.updated_at and re-registers dispute webhooks when an offline session exists", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });
    mockLoadSession.mockResolvedValue({
      accessToken: "shpat_OFFLINE",
      shopDomain: "demo.myshopify.com",
    } as never);

    const res = await POST(makeReq(PAYLOAD));

    expect(res.status).toBe(200);
    expect(spies.shopsUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = spies.shopsUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updateArgs.updated_at).toBe("string");

    // Webhook re-registration is fire-and-forget (.then/.catch chain),
    // but the call site DOES synchronously kick off the call.
    expect(mockLoadSession).toHaveBeenCalledWith("shop-1", "offline");
    expect(mockRegister).toHaveBeenCalledWith({
      shopDomain: "demo.myshopify.com",
      accessToken: "shpat_OFFLINE",
    });
  });

  it("happy path without offline session: still updates the shop row, skips re-registration", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });
    mockLoadSession.mockResolvedValue(null as never);

    const res = await POST(makeReq(PAYLOAD));

    expect(res.status).toBe(200);
    expect(spies.shopsUpdate).toHaveBeenCalledTimes(1);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("happy path with no shop row in our DB: still returns 200 + bumps updated_at by domain (no-op for missing rows)", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq(PAYLOAD));

    expect(res.status).toBe(200);
    expect(spies.shopsUpdate).toHaveBeenCalledTimes(1);
    expect(mockRegister).not.toHaveBeenCalled();
  });
});
