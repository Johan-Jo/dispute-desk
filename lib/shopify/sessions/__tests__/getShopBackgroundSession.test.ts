/**
 * Tests for `getShopBackgroundSession` — the single choke point most
 * background Shopify calls funnel through, and where proactive token
 * refresh is wired in (docs/plans/expiring-offline-tokens.plan.md
 * Stage 2).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../sessionStorage", () => ({
  loadSession: vi.fn(),
}));
vi.mock("../refreshOfflineToken", () => ({
  ensureFreshSession: vi.fn(),
}));

import { loadSession } from "../../sessionStorage";
import { ensureFreshSession } from "../refreshOfflineToken";
import {
  getShopBackgroundSession,
  NoBackgroundSessionError,
  detectAuthInvalidReason,
} from "../getShopBackgroundSession";
import type { StoredSession } from "../../sessionStorage";

const mockLoadSession = vi.mocked(loadSession);
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

describe("getShopBackgroundSession", () => {
  it("throws NoBackgroundSessionError when no offline session exists", async () => {
    mockLoadSession.mockResolvedValue(null);
    await expect(getShopBackgroundSession("shop-1")).rejects.toThrow(
      NoBackgroundSessionError,
    );
    expect(mockEnsureFresh).not.toHaveBeenCalled();
  });

  it("runs every loaded session through ensureFreshSession and returns its result", async () => {
    const loaded = session();
    const refreshed = session({ accessToken: "shpat_refreshed" });
    mockLoadSession.mockResolvedValue(loaded);
    mockEnsureFresh.mockResolvedValue(refreshed);

    const result = await getShopBackgroundSession("shop-1");

    expect(mockEnsureFresh).toHaveBeenCalledWith(loaded);
    expect(result).toBe(refreshed);
  });

  it("still calls ensureFreshSession for legacy sessions (it no-ops internally)", async () => {
    const legacy = session({ tokenExpiring: false, refreshToken: null });
    mockLoadSession.mockResolvedValue(legacy);
    mockEnsureFresh.mockResolvedValue(legacy);

    const result = await getShopBackgroundSession("shop-1");

    expect(mockEnsureFresh).toHaveBeenCalledWith(legacy);
    expect(result).toBe(legacy);
  });
});

describe("detectAuthInvalidReason", () => {
  it("matches HTTP 401", () => {
    expect(detectAuthInvalidReason({ status: 401 })).toBe("HTTP 401");
  });

  it("matches the legacy non-expiring-token rejection message", () => {
    expect(
      detectAuthInvalidReason({
        errors: [{ message: "[API] Non-expiring access tokens are no longer accepted for the Admin API" }],
      }),
    ).toBeTruthy();
  });

  it("returns null for unrelated errors (throttle, userErrors)", () => {
    expect(
      detectAuthInvalidReason({ errors: [{ message: "Throttled" }] }),
    ).toBeNull();
    expect(detectAuthInvalidReason({})).toBeNull();
  });
});
