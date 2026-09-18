/**
 * Tests for POST /api/webhooks/shop/redact — GDPR mandatory full-shop
 * deletion 48h post-uninstall.
 *
 * The route delegates the erasure to the `admin_purge_shop` SQL function.
 * It previously walked a hardcoded table list with one PostgREST DELETE per
 * table, which could not complete: `audit_events` / `dispute_events` refuse
 * deletes via BEFORE DELETE triggers, the loop swallowed that error, and the
 * final `shops` delete then failed too — leaving shops permanently
 * half-redacted while still answering 200.
 *
 * So the assertions here are mostly about NOT repeating that: one atomic
 * call, and a failure that is reported rather than hidden behind a 200.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/webhooks/verify", () => ({
  verifyShopifyWebhook: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { verifyShopifyWebhook } from "@/lib/webhooks/verify";
import { POST } from "@/app/api/webhooks/shop-redact/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);

interface Spies {
  rpcCalls: Array<{ fn: string; args: unknown }>;
}

function setupSupabase(opts: {
  shopRow?: { id: string } | null;
  /** Simulate the purge function itself failing. */
  rpcError?: string;
}): Spies {
  const rpcCalls: Spies["rpcCalls"] = [];

  mockGetServiceClient.mockReturnValue({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: opts.shopRow ?? null, error: null }),
        }),
      }),
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(
        opts.rpcError
          ? { data: null, error: { message: opts.rpcError } }
          : { data: { ok: true, shop_domain: "demo.myshopify.com" }, error: null },
      );
    },
  } as never);

  return { rpcCalls };
}

const PAYLOAD = JSON.stringify({
  shop_id: 12345,
  shop_domain: "demo.myshopify.com",
});

function makeReq(opts: { body: string; hmac?: string | null; shopHeader?: string | null }) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null && opts.hmac !== undefined) headers["x-shopify-hmac-sha256"] = opts.hmac;
  if (opts.shopHeader) headers["x-shopify-shop-domain"] = opts.shopHeader;
  return new NextRequest("http://localhost/api/webhooks/shop-redact", {
    method: "POST",
    body: opts.body,
    headers,
  });
}

describe("POST /api/webhooks/shop/redact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when HMAC fails, and purges nothing", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "bad" }));

    expect(res.status).toBe(401);
    expect(spies.rpcCalls).toEqual([]);
  });

  it("returns 200 with skipped:invalid_json on malformed body", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "not-json", hmac: "ok" }));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("invalid_json");
  });

  it("returns 400 when shop domain missing", async () => {
    mockVerify.mockReturnValue(true);
    const res = await POST(makeReq({ body: "{}", hmac: "ok" }));
    expect(res.status).toBe(400);
  });

  it("returns 200 with skipped:unknown_shop for an already-purged shop (idempotent re-delivery)", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("unknown_shop");
    expect(spies.rpcCalls).toEqual([]);
  });

  it("happy path: one atomic admin_purge_shop call for the resolved shop", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(200);
    expect((await res.json()).purged).toEqual({
      ok: true,
      shop_domain: "demo.myshopify.com",
    });
    // Exactly one call — not a per-table loop, which is what allowed a
    // partial erasure to look like a success.
    expect(spies.rpcCalls).toEqual([
      { fn: "admin_purge_shop", args: { p_shop_id: "shop-1" } },
    ]);
  });

  it("returns 500 when the purge fails, so Shopify retries instead of assuming success", async () => {
    // The regression that mattered: the old loop logged its errors and
    // still answered 200, so an incomplete redaction was never retried
    // and never noticed.
    mockVerify.mockReturnValue(true);
    setupSupabase({
      shopRow: { id: "shop-1" },
      rpcError: "audit_events is append-only: DELETE not allowed",
    });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" }));

    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBeUndefined();
  });
});
