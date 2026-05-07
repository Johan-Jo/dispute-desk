/**
 * Tests for POST /api/webhooks/app-uninstalled.
 *
 * Mocks HMAC verification and the Supabase client. Covers:
 *   - 401 when HMAC verification fails (no DB writes)
 *   - 400 when shop domain is missing from BOTH header and payload
 *   - 200 ok:true when the shop isn't in our DB (idempotent uninstall)
 *   - 200 happy path: marks shop uninstalled_at, deletes shop_sessions,
 *     fails any queued/running jobs
 *   - Header > payload precedence for shop domain
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
import { POST } from "@/app/api/webhooks/app-uninstalled/route";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockVerify = vi.mocked(verifyShopifyWebhook);

interface SupabaseSpies {
  shopsUpdate: ReturnType<typeof vi.fn>;
  sessionsDelete: ReturnType<typeof vi.fn>;
  jobsUpdate: ReturnType<typeof vi.fn>;
}

function setupSupabase(opts: { shopRow?: { id: string } | null }): SupabaseSpies {
  const shopsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const sessionsDelete = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  });
  const jobsUpdate = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: null, error: null }),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromImpl = (table: string): any => {
    if (table === "shops") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: opts.shopRow ?? null,
          error: opts.shopRow ? null : { message: "not found" },
        }),
        update: shopsUpdate,
      };
    }
    if (table === "shop_sessions") {
      return { delete: sessionsDelete };
    }
    if (table === "jobs") {
      return { update: jobsUpdate };
    }
    throw new Error(`unexpected table: ${table}`);
  };

  mockGetServiceClient.mockReturnValue({ from: fromImpl } as never);
  return { shopsUpdate, sessionsDelete, jobsUpdate };
}

function makeReq(opts: {
  body: string;
  hmac?: string | null;
  shopHeader?: string | null;
} = { body: "{}" }) {
  const headers: Record<string, string> = {};
  if (opts.hmac !== null && opts.hmac !== undefined) headers["x-shopify-hmac-sha256"] = opts.hmac;
  if (opts.shopHeader) headers["x-shopify-shop-domain"] = opts.shopHeader;
  return new NextRequest("http://localhost/api/webhooks/app-uninstalled", {
    method: "POST",
    body: opts.body,
    headers,
  });
}

const PAYLOAD = JSON.stringify({
  myshopify_domain: "demo.myshopify.com",
  id: 12345,
});

describe("POST /api/webhooks/app-uninstalled", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when HMAC verification fails (no DB writes)", async () => {
    mockVerify.mockReturnValue(false);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "bad", shopHeader: "demo.myshopify.com" }));

    expect(res.status).toBe(401);
    expect(spies.shopsUpdate).not.toHaveBeenCalled();
    expect(spies.sessionsDelete).not.toHaveBeenCalled();
    expect(spies.jobsUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when shop domain is missing from both header and payload", async () => {
    mockVerify.mockReturnValue(true);
    setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: "{}", hmac: "ok" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing shop domain");
  });

  it("returns 200 ok:true when the shop isn't in our DB (idempotent — Shopify retries are safe)", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: null });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok", shopHeader: "ghost.myshopify.com" }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(spies.shopsUpdate).not.toHaveBeenCalled();
  });

  it("happy path: marks the shop uninstalled, deletes sessions, and fails queued/running jobs", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok", shopHeader: "demo.myshopify.com" }));

    expect(res.status).toBe(200);
    expect(spies.shopsUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = spies.shopsUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updateArgs.uninstalled_at).toBe("string");

    expect(spies.sessionsDelete).toHaveBeenCalledTimes(1);

    expect(spies.jobsUpdate).toHaveBeenCalledTimes(1);
    const jobsArgs = spies.jobsUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(jobsArgs.status).toBe("failed");
    expect(jobsArgs.last_error).toBe("App uninstalled");
  });

  it("falls back to payload's myshopify_domain when the x-shopify-shop-domain header is absent", async () => {
    mockVerify.mockReturnValue(true);
    const spies = setupSupabase({ shopRow: { id: "shop-1" } });

    const res = await POST(makeReq({ body: PAYLOAD, hmac: "ok" })); // no shopHeader

    expect(res.status).toBe(200);
    expect(spies.shopsUpdate).toHaveBeenCalledTimes(1);
  });
});
