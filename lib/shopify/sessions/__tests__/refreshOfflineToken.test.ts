/**
 * Tests for the expiring-offline-token refresh helper
 * (docs/plans/expiring-offline-tokens.plan.md Stage 2).
 *
 * Covers: expiry-window math, the refresh request shape sent to
 * Shopify, the optimistic per-row claim (win/lose), graceful failure
 * (never throws — returns the original session), and that legacy
 * (non-expiring) sessions are never touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";
import {
  needsRefresh,
  ensureFreshSession,
} from "../refreshOfflineToken";
import type { StoredSession } from "../../sessionStorage";

const mockGetServiceClient = vi.mocked(getServiceClient);

type Result = { data?: unknown; error?: unknown };

function makeSb(script: Result[]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const queue = [...script];
  const next = (): Result => (queue.length > 0 ? queue.shift()! : { data: null, error: null });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "is", "or", "order", "limit", "update"]) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ op: m, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => next();
  chain.single = async () => next();
  chain.then = (resolve: (v: Result) => unknown) => Promise.resolve(next()).then(resolve);

  const sb = { from: vi.fn(() => chain) } as never;
  return { sb, calls };
}

function makeSession(over: Partial<StoredSession> = {}): StoredSession {
  return {
    id: "sess-1",
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
  vi.unstubAllGlobals();
  process.env.TOKEN_ENCRYPTION_KEY_V1 = "a".repeat(64);
});

describe("needsRefresh", () => {
  it("false for a legacy (non-expiring) session regardless of expiresAt", () => {
    expect(
      needsRefresh(makeSession({ tokenExpiring: false, expiresAt: "2020-01-01T00:00:00Z" })),
    ).toBe(false);
  });

  it("false when expiresAt has ample headroom", () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect(needsRefresh(makeSession({ expiresAt: farFuture }))).toBe(false);
  });

  it("true when expiresAt is within the 5-minute skew window", () => {
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    expect(needsRefresh(makeSession({ expiresAt: soon }))).toBe(true);
  });

  it("true when already expired", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(needsRefresh(makeSession({ expiresAt: past }))).toBe(true);
  });
});

describe("ensureFreshSession — no-op paths", () => {
  it("returns the session unchanged when it doesn't need refresh", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const session = makeSession({ expiresAt: farFuture });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await ensureFreshSession(session);
    expect(result).toBe(session);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never refreshes a legacy session even with force:true", async () => {
    const session = makeSession({ tokenExpiring: false, refreshToken: null });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await ensureFreshSession(session, { force: true });
    expect(result).toBe(session);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the session unchanged when tokenExpiring=true but refreshToken is missing (data bug)", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const session = makeSession({ expiresAt: past, refreshToken: null });
    const { sb } = makeSb([]);
    mockGetServiceClient.mockReturnValue(sb);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await ensureFreshSession(session);
    expect(result).toBe(session);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("ensureFreshSession — claim + refresh", () => {
  const expired = () => makeSession({ expiresAt: new Date(Date.now() - 1000).toISOString() });

  it("sends grant_type=refresh_token with the stored refresh token, persists the rotated pair", async () => {
    const session = expired();
    const { sb, calls } = makeSb([
      { data: [{ id: session.id }], error: null }, // claim won
      {
        data: {
          id: session.id,
          shop_id: session.shopId,
          session_type: "offline",
          user_id: null,
          shop_domain: session.shopDomain,
          scopes: "read_orders",
          expires_at: "irrelevant-overwritten-below",
          refresh_token_expires_at: "irrelevant-overwritten-below",
          token_expiring: true,
        },
        error: null,
      }, // updateSessionTokens
    ]);
    mockGetServiceClient.mockReturnValue(sb);

    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      text: async () => "",
      json: async () => ({
        access_token: "shpat_rotated",
        scope: "read_orders",
        expires_in: 3600,
        refresh_token: "shprt_rotated",
        refresh_token_expires_in: 7_776_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await ensureFreshSession(session);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(`https://${session.shopDomain}/admin/oauth/access_token`);
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("shprt_old");

    const claimUpdate = calls.find(
      (c) => c.op === "update" && (c.args[0] as Record<string, unknown>).refresh_claimed_at,
    );
    expect(claimUpdate).toBeTruthy();

    expect(result.accessToken).toBe("shpat_rotated");
    expect(result.refreshToken).toBe("shprt_rotated");
  });

  it("loses the claim to another instance -> re-reads instead of calling Shopify", async () => {
    const session = expired();
    const alreadyRefreshed = {
      id: session.id,
      shop_id: session.shopId,
      session_type: "offline",
      user_id: null,
      shop_domain: session.shopDomain,
      access_token_encrypted: "v1:00:00:cipher", // decrypt() would fail on this;
      scopes: "read_orders",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      refresh_token_encrypted: null,
      refresh_token_expires_at: null,
      token_expiring: true,
    };
    const { sb } = makeSb([
      { data: [], error: null }, // claim lost
      { data: alreadyRefreshed, error: null }, // loadSession re-read
    ]);
    mockGetServiceClient.mockReturnValue(sb);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // decrypt() on the placeholder ciphertext would throw — that's fine,
    // this test only asserts Shopify was never called on claim loss.
    await ensureFreshSession(session).catch(() => {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Shopify rejects the refresh -> returns the original session, never throws", async () => {
    const session = expired();
    const { sb } = makeSb([{ data: [{ id: session.id }], error: null }]);
    mockGetServiceClient.mockReturnValue(sb);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => "invalid_grant" })),
    );

    const result = await ensureFreshSession(session);
    expect(result).toBe(session);
  });

  it("force:true refreshes even with ample headroom", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const session = makeSession({ expiresAt: farFuture });
    const { sb } = makeSb([
      { data: [{ id: session.id }], error: null },
      {
        data: {
          id: session.id,
          shop_id: session.shopId,
          session_type: "offline",
          user_id: null,
          shop_domain: session.shopDomain,
          scopes: "read_orders",
          expires_at: "x",
          refresh_token_expires_at: "x",
          token_expiring: true,
        },
        error: null,
      },
    ]);
    mockGetServiceClient.mockReturnValue(sb);
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      text: async () => "",
      json: async () => ({
        access_token: "shpat_forced",
        scope: "read_orders",
        expires_in: 3600,
        refresh_token: "shprt_forced",
        refresh_token_expires_in: 7_776_000,
      }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await ensureFreshSession(session, { force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.accessToken).toBe("shpat_forced");
  });
});
