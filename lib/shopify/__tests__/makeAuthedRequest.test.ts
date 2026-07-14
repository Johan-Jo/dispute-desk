/**
 * Tests for the reactive refresh-and-retry in `makeAuthedRequest`
 * (docs/plans/expiring-offline-tokens.plan.md Stage 2, belt-and-suspenders).
 *
 * `getShopBackgroundSession` already refreshes proactively; this covers
 * the fallback path for when a session that looked fresh still gets an
 * auth-invalid response back from Shopify (clock skew / early
 * invalidation) — exactly one forced refresh + retry, and only for
 * expiring-token sessions.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../graphql", () => ({
  requestShopifyGraphQL: vi.fn(),
}));
vi.mock("../sessions/getShopBackgroundSession", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sessions/getShopBackgroundSession")>();
  return {
    ...actual,
    getShopBackgroundSession: vi.fn(),
  };
});
vi.mock("../sessions/refreshOfflineToken", () => ({
  ensureFreshSession: vi.fn(),
}));

import { requestShopifyGraphQL } from "../graphql";
import { getShopBackgroundSession } from "../sessions/getShopBackgroundSession";
import { ensureFreshSession } from "../sessions/refreshOfflineToken";
import { makeAuthedRequest } from "../makeAuthedRequest";
import type { StoredSession } from "../sessionStorage";

const mockRequest = vi.mocked(requestShopifyGraphQL);
const mockGetSession = vi.mocked(getShopBackgroundSession);
const mockEnsureFresh = vi.mocked(ensureFreshSession);

function session(over: Partial<StoredSession> = {}): StoredSession {
  return {
    id: "s1",
    shopId: "shop-1",
    sessionType: "offline",
    userId: null,
    shopDomain: "acme.myshopify.com",
    accessToken: "shpat_old",
    scopes: "read_orders",
    expiresAt: "2026-07-15T13:00:00Z",
    refreshToken: "shprt_old",
    refreshTokenExpiresAt: "2026-10-13T13:00:00Z",
    tokenExpiring: true,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeAuthedRequest — reactive refresh on auth-invalid", () => {
  it("retries once with the refreshed token when the first call is auth-invalid", async () => {
    mockGetSession.mockResolvedValue(session());
    mockRequest
      .mockResolvedValueOnce({ errors: [{ message: "Invalid API key or access token" }] })
      .mockResolvedValueOnce({ data: { shop: { name: "Acme" } } });
    mockEnsureFresh.mockResolvedValue(
      session({ accessToken: "shpat_new", refreshToken: "shprt_new" }),
    );

    const result = await makeAuthedRequest({ shopId: "shop-1", query: "{ shop { name } }" });

    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockEnsureFresh).toHaveBeenCalledWith(expect.objectContaining({ id: "s1" }), {
      force: true,
    });
    const secondCallArgs = mockRequest.mock.calls[1][0];
    expect(secondCallArgs.session.accessToken).toBe("shpat_new");
    expect(result).toEqual({ data: { shop: { name: "Acme" } } });
  });

  it("does not retry a legacy (non-expiring) session's auth error", async () => {
    mockGetSession.mockResolvedValue(session({ tokenExpiring: false }));
    const authError = { errors: [{ message: "Invalid API key or access token" }] };
    mockRequest.mockResolvedValueOnce(authError);

    const result = await makeAuthedRequest({ shopId: "shop-1", query: "{ shop { name } }" });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockEnsureFresh).not.toHaveBeenCalled();
    expect(result).toEqual(authError);
  });

  it("does not retry non-auth errors", async () => {
    mockGetSession.mockResolvedValue(session());
    const throttled = { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
    mockRequest.mockResolvedValueOnce(throttled);

    const result = await makeAuthedRequest({ shopId: "shop-1", query: "{ shop { name } }" });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockEnsureFresh).not.toHaveBeenCalled();
    expect(result).toEqual(throttled);
  });

  it("gives up after a failed forced refresh (token unchanged) instead of retrying with the same token", async () => {
    const original = session();
    mockGetSession.mockResolvedValue(original);
    const authError = { errors: [{ message: "Invalid API key or access token" }] };
    mockRequest.mockResolvedValueOnce(authError);
    mockEnsureFresh.mockResolvedValue(original); // refresh failed internally, same session back

    const result = await makeAuthedRequest({ shopId: "shop-1", query: "{ shop { name } }" });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(result).toEqual(authError);
  });
});
