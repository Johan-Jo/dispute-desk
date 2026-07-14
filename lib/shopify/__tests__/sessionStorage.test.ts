/**
 * Tests for the expiring-offline-token storage layer
 * (docs/plans/expiring-offline-tokens.plan.md Stage 1).
 *
 * Uses real AES-256-GCM encryption (test keys set in beforeEach — same
 * pattern as tests/unit/encryption.test.ts) against a scripted-queue
 * Supabase fake, so the round-trip through storeSession/loadSession
 * exercises the actual crypto, not a mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: vi.fn(),
}));

import { getServiceClient } from "@/lib/supabase/server";

const mockGetServiceClient = vi.mocked(getServiceClient);

type Result = { data?: unknown; error?: unknown };

/** Scriptable Supabase fake: FIFO queue of results for shop_sessions,
 *  matching the reviewRoutes.test.ts pattern used elsewhere in this repo. */
function makeSb(script: Result[]) {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const queue = [...script];
  const next = (): Result => (queue.length > 0 ? queue.shift()! : { data: null, error: null });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["select", "eq", "is", "order", "limit", "insert", "update", "upsert", "delete"]) {
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

beforeEach(() => {
  process.env.TOKEN_ENCRYPTION_KEY_V1 = "a".repeat(64);
  delete process.env.TOKEN_ENCRYPTION_KEY_V2;
  vi.clearAllMocks();
});

describe("storeSession — offline, expiring variant", () => {
  it("encrypts both tokens and persists refresh/expiry columns", async () => {
    const { storeSession } = await import("../sessionStorage");
    const { sb, calls } = makeSb([
      { data: null, error: null }, // delete
      { data: { id: "s1" }, error: null }, // insert
    ]);
    mockGetServiceClient.mockReturnValue(sb);

    await storeSession({
      shopInternalId: "shop-1",
      shopDomain: "acme.myshopify.com",
      sessionType: "offline",
      accessToken: "shpat_live_123",
      scopes: "read_orders",
      expiresAt: "2026-07-15T13:00:00Z",
      refreshToken: "shprt_live_456",
      refreshTokenExpiresAt: "2026-10-13T13:00:00Z",
      tokenExpiring: true,
    });

    const insertCall = calls.find((c) => c.op === "insert");
    expect(insertCall).toBeTruthy();
    const row = insertCall!.args[0] as Record<string, unknown>;
    expect(row.token_expiring).toBe(true);
    expect(row.expires_at).toBe("2026-07-15T13:00:00Z");
    expect(row.refresh_token_expires_at).toBe("2026-10-13T13:00:00Z");
    // Never store plaintext.
    expect(row.access_token_encrypted).not.toContain("shpat_live_123");
    expect(String(row.refresh_token_encrypted)).not.toContain("shprt_live_456");
    expect(typeof row.refresh_token_encrypted).toBe("string");
  });

  it("stores refresh_token_encrypted=null and token_expiring=false for a legacy session", async () => {
    const { storeSession } = await import("../sessionStorage");
    const { sb, calls } = makeSb([{ data: null, error: null }, { data: { id: "s1" }, error: null }]);
    mockGetServiceClient.mockReturnValue(sb);

    await storeSession({
      shopInternalId: "shop-1",
      shopDomain: "acme.myshopify.com",
      sessionType: "offline",
      accessToken: "shpat_legacy",
      scopes: "read_orders",
      expiresAt: null,
    });

    const row = calls.find((c) => c.op === "insert")!.args[0] as Record<string, unknown>;
    expect(row.token_expiring).toBe(false);
    expect(row.refresh_token_encrypted).toBeNull();
    expect(row.refresh_token_expires_at).toBeNull();
  });
});

describe("loadSession — decrypts refresh token round-trip", () => {
  it("returns tokenExpiring=true + decrypted refreshToken for an expiring row", async () => {
    const { encrypt, serializeEncrypted } = await import("@/lib/security/encryption");
    const { storeSession, loadSession } = await import("../sessionStorage");

    // Encrypt for real, then hand the ciphertext back out of a scripted
    // maybeSingle() so loadSession decrypts it for real too.
    const accessEnc = serializeEncrypted(encrypt("shpat_live_123"));
    const refreshEnc = serializeEncrypted(encrypt("shprt_live_456"));
    void storeSession; // imported for symmetry/documentation; not used directly here

    const { sb } = makeSb([
      {
        data: {
          id: "s1",
          shop_id: "shop-1",
          session_type: "offline",
          user_id: null,
          shop_domain: "acme.myshopify.com",
          access_token_encrypted: accessEnc,
          scopes: "read_orders",
          expires_at: "2026-07-15T13:00:00Z",
          refresh_token_encrypted: refreshEnc,
          refresh_token_expires_at: "2026-10-13T13:00:00Z",
          token_expiring: true,
        },
        error: null,
      },
    ]);
    mockGetServiceClient.mockReturnValue(sb);

    const session = await loadSession("shop-1", "offline");
    expect(session).toMatchObject({
      accessToken: "shpat_live_123",
      refreshToken: "shprt_live_456",
      tokenExpiring: true,
      refreshTokenExpiresAt: "2026-10-13T13:00:00Z",
    });
  });

  it("returns refreshToken=null + tokenExpiring=false for a legacy row (no refresh_token_encrypted)", async () => {
    const { encrypt, serializeEncrypted } = await import("@/lib/security/encryption");
    const { loadSession } = await import("../sessionStorage");

    const accessEnc = serializeEncrypted(encrypt("shpat_legacy"));
    const { sb } = makeSb([
      {
        data: {
          id: "s1",
          shop_id: "shop-1",
          session_type: "offline",
          user_id: null,
          shop_domain: "acme.myshopify.com",
          access_token_encrypted: accessEnc,
          scopes: "read_orders",
          expires_at: null,
          refresh_token_encrypted: null,
          refresh_token_expires_at: null,
          token_expiring: false,
        },
        error: null,
      },
    ]);
    mockGetServiceClient.mockReturnValue(sb);

    const session = await loadSession("shop-1", "offline");
    expect(session?.refreshToken).toBeNull();
    expect(session?.tokenExpiring).toBe(false);
  });
});

describe("updateSessionTokens — in-place refresh persistence", () => {
  it("re-encrypts both tokens, updates by id, and clears the refresh claim", async () => {
    const { updateSessionTokens } = await import("../sessionStorage");
    const { sb, calls } = makeSb([
      {
        data: {
          id: "s1",
          shop_id: "shop-1",
          session_type: "offline",
          user_id: null,
          shop_domain: "acme.myshopify.com",
          scopes: "read_orders",
          expires_at: "2026-07-15T14:00:00Z",
          refresh_token_expires_at: "2026-10-13T14:00:00Z",
          token_expiring: true,
        },
        error: null,
      },
    ]);
    mockGetServiceClient.mockReturnValue(sb);

    const result = await updateSessionTokens("s1", {
      accessToken: "shpat_rotated",
      scopes: "read_orders",
      expiresAt: "2026-07-15T14:00:00Z",
      refreshToken: "shprt_rotated",
      refreshTokenExpiresAt: "2026-10-13T14:00:00Z",
      tokenExpiring: true,
    });

    const updateCall = calls.find((c) => c.op === "update");
    expect(updateCall).toBeTruthy();
    const patch = updateCall!.args[0] as Record<string, unknown>;
    expect(patch.refresh_claimed_at).toBeNull();
    expect(patch.token_expiring).toBe(true);
    expect(String(patch.access_token_encrypted)).not.toContain("shpat_rotated");
    // The row is targeted by id, not a delete+insert (no new row id).
    const eqCall = calls.find((c) => c.op === "eq");
    expect(eqCall!.args).toEqual(["id", "s1"]);

    expect(result?.id).toBe("s1");
    expect(result?.accessToken).toBe("shpat_rotated");
    expect(result?.refreshToken).toBe("shprt_rotated");
  });
});
