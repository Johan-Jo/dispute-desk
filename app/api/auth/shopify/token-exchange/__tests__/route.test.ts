/**
 * Tests for the token-exchange route's expiring-token behavior
 * (docs/plans/expiring-offline-tokens.plan.md Stages 2-3):
 *   - the mint request now sends expiring=1
 *   - an existing EXPIRING session is reused (no exchange call)
 *   - an existing LEGACY session is NOT skipped — it's upgraded via the
 *     same id_token, in place
 *   - a failed upgrade attempt degrades gracefully (redirects using the
 *     still-usable legacy session) rather than breaking the whole login
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));
vi.mock("@/lib/shopify/sessionStorage", () => ({
  storeSession: vi.fn(),
  loadSession: vi.fn(),
}));
vi.mock("@/lib/shopify/sessionToken", () => ({
  verifySessionToken: vi.fn(),
}));
vi.mock("@/lib/shopify/registerDisputeWebhooks", () => ({
  registerDisputeWebhooks: vi.fn().mockResolvedValue({ ok: true, errors: [] }),
}));
vi.mock("@/lib/shopify/persistShopCurrency", () => ({
  persistShopCurrency: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from "@/lib/supabase/server";
import { storeSession, loadSession } from "@/lib/shopify/sessionStorage";
import { verifySessionToken } from "@/lib/shopify/sessionToken";
import { GET } from "../route";
import type { NextRequest } from "next/server";

const mockGetServiceClient = vi.mocked(getServiceClient);
const mockStoreSession = vi.mocked(storeSession);
const mockLoadSession = vi.mocked(loadSession);
const mockVerify = vi.mocked(verifySessionToken);

function makeShopsTable(shopRow: { id: string } | null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "update", "insert"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: shopRow, error: null });
  chain.single = async () => ({ data: shopRow ?? { id: "shop-new" }, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return chain;
}

function makeRequest(url: string): NextRequest {
  return {
    url,
    nextUrl: new URL(url),
  } as unknown as NextRequest;
}

const BASE_URL =
  "https://dev.disputedesk.app/api/auth/shopify/token-exchange?id_token=tok123&shop=acme.myshopify.com&host=host123&return_to=%2Fapp";

beforeEach(() => {
  vi.clearAllMocks();
  mockVerify.mockReturnValue({ shopDomain: "acme.myshopify.com" } as never);
  mockGetServiceClient.mockReturnValue(makeShopsTable({ id: "shop-1" }) as never);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      text: async () => "",
      json: async () => ({
        access_token: "shpat_new",
        scope: "read_orders",
        expires_in: 3600,
        refresh_token: "shprt_new",
        refresh_token_expires_in: 7_776_000,
      }),
    })),
  );
});

describe("GET /api/auth/shopify/token-exchange — expiring tokens", () => {
  it("mints with expiring=1 and stores the expiring variant on first install (no existing session)", async () => {
    mockLoadSession.mockResolvedValue(null);

    const res = await GET(makeRequest(BASE_URL));

    expect(res.status).toBe(307);
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.expiring).toBe("1");

    expect(mockStoreSession).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "shpat_new",
        refreshToken: "shprt_new",
        tokenExpiring: true,
      }),
    );
  });

  it("skips the exchange when the existing session is already the expiring variant", async () => {
    mockLoadSession.mockResolvedValue({
      id: "s1",
      shopId: "shop-1",
      sessionType: "offline",
      userId: null,
      shopDomain: "acme.myshopify.com",
      accessToken: "shpat_current",
      scopes: "read_orders",
      // Far-future so `needsRefresh` is deterministically false regardless
      // of when the suite runs. A near-now literal here is a time bomb: the
      // original "2026-07-15T14:00:00Z" fell inside the refresh skew once
      // wall-clock passed that instant on 2026-07-15, flipping the route to
      // re-exchange and breaking this "should skip" assertion in CI.
      expiresAt: "2099-01-01T00:00:00Z",
      refreshToken: "shprt_current",
      refreshTokenExpiresAt: "2099-04-01T00:00:00Z",
      tokenExpiring: true,
    });

    const res = await GET(makeRequest(BASE_URL));

    expect(res.status).toBe(307);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(mockStoreSession).not.toHaveBeenCalled();
  });

  it("re-exchanges when the existing expiring session's access token is expired (recovers a dead token instead of skipping)", async () => {
    mockLoadSession.mockResolvedValue({
      id: "s1",
      shopId: "shop-1",
      sessionType: "offline",
      userId: null,
      shopDomain: "acme.myshopify.com",
      accessToken: "shpat_stale",
      scopes: "read_orders",
      // Access token already expired — the background refresh never ran
      // (e.g. worker disabled), so the app load must mint a fresh pair.
      expiresAt: "2020-01-01T00:00:00Z",
      refreshToken: "shprt_stale",
      refreshTokenExpiresAt: "2026-10-13T14:00:00Z",
      tokenExpiring: true,
    });

    const res = await GET(makeRequest(BASE_URL));

    expect(res.status).toBe(307);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(mockStoreSession).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "shpat_new", tokenExpiring: true }),
    );
  });

  it("upgrades an existing LEGACY session instead of reusing it forever", async () => {
    mockLoadSession.mockResolvedValue({
      id: "s1",
      shopId: "shop-1",
      sessionType: "offline",
      userId: null,
      shopDomain: "acme.myshopify.com",
      accessToken: "shpat_legacy",
      scopes: "read_orders",
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenExpiring: false,
    });

    const res = await GET(makeRequest(BASE_URL));

    expect(res.status).toBe(307);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(mockStoreSession).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "shpat_new", tokenExpiring: true }),
    );
  });

  it("degrades gracefully when the upgrade exchange fails — still redirects, doesn't store", async () => {
    mockLoadSession.mockResolvedValue({
      id: "s1",
      shopId: "shop-1",
      sessionType: "offline",
      userId: null,
      shopDomain: "acme.myshopify.com",
      accessToken: "shpat_legacy",
      scopes: "read_orders",
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      tokenExpiring: false,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_grant" })),
    );

    const res = await GET(makeRequest(BASE_URL));

    // Graceful degradation: the request still succeeds (redirect), the
    // merchant isn't locked out of an otherwise-working install.
    expect(res.status).toBe(307);
    expect(mockStoreSession).not.toHaveBeenCalled();
  });

  it("hard-fails only when there's no prior session to fall back on", async () => {
    mockLoadSession.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_grant" })),
    );

    const res = await GET(makeRequest(BASE_URL));
    expect(res.status).toBe(401);
  });
});
