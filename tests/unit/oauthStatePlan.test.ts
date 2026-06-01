import { describe, expect, it, beforeAll } from "vitest";

// The auth module reads SHOPIFY_API_SECRET at import time for HMAC signing.
beforeAll(() => {
  process.env.SHOPIFY_API_SECRET ??= "test-secret-for-oauth-state";
});

describe("OAuth state — plan round-trip", () => {
  it("carries an optional plan through encode → decode", async () => {
    const { encodeOAuthState, decodeOAuthState } = await import("@/lib/shopify/auth");
    const token = encodeOAuthState({
      nonce: "abc",
      phase: "offline",
      source: "embedded",
      returnTo: "",
      plan: "growth",
    });
    const decoded = decodeOAuthState(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.plan).toBe("growth");
    expect(decoded?.phase).toBe("offline");
  });

  it("omitting plan is valid and decodes without one (back-compat)", async () => {
    const { encodeOAuthState, decodeOAuthState } = await import("@/lib/shopify/auth");
    const token = encodeOAuthState({
      nonce: "abc",
      phase: "offline",
      source: "portal",
      returnTo: "/portal/dashboard",
    });
    const decoded = decodeOAuthState(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.plan).toBeUndefined();
    expect(decoded?.source).toBe("portal");
  });

  it("rejects a tampered token", async () => {
    const { encodeOAuthState, decodeOAuthState } = await import("@/lib/shopify/auth");
    const token = encodeOAuthState({
      nonce: "abc",
      phase: "offline",
      source: "embedded",
      returnTo: "",
      plan: "scale",
    });
    // Flip the last char of the payload (before the dot).
    const dot = token.lastIndexOf(".");
    const tampered =
      token.slice(0, dot - 1) +
      (token[dot - 1] === "A" ? "B" : "A") +
      token.slice(dot);
    expect(decodeOAuthState(tampered)).toBeNull();
  });
});

describe("plan param normalization (install route policy)", () => {
  // Mirror of normalizePlanParam in app/api/auth/shopify/route.ts: only paid
  // tiers deep-link to the upgrade screen; free/unknown/garbage → undefined.
  it("only paid tiers are accepted as deep-link targets", async () => {
    const { PLANS } = await import("@/lib/billing/plans");
    const normalize = (value: string | null): string | undefined => {
      if (!value) return undefined;
      const v = value.toLowerCase();
      if (v in PLANS && v !== "free") return v;
      return undefined;
    };
    expect(normalize("growth")).toBe("growth");
    expect(normalize("STARTER")).toBe("starter");
    expect(normalize("scale")).toBe("scale");
    expect(normalize("free")).toBeUndefined();
    expect(normalize("enterprise")).toBeUndefined();
    expect(normalize("")).toBeUndefined();
    expect(normalize(null)).toBeUndefined();
  });
});
