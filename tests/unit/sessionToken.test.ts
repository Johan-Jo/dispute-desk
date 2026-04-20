import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "node:crypto";

const SECRET = "test-secret-for-hmac";
const API_KEY = "test-api-key-123";

function base64UrlEncode(input: Buffer | string): string {
  const b = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload: Record<string, unknown>): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(
    crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest(),
  );
  return `${header}.${body}.${sig}`;
}

describe("verifySessionToken", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SHOPIFY_API_KEY = API_KEY;
    process.env.SHOPIFY_API_SECRET = SECRET;
  });

  const nowSec = Math.floor(Date.now() / 1000);
  const validPayload = {
    iss: "https://surasvenne.myshopify.com/admin",
    dest: "https://surasvenne.myshopify.com",
    aud: API_KEY,
    sub: "105276702777",
    exp: nowSec + 60,
    nbf: nowSec - 5,
    iat: nowSec,
    jti: "jti-1",
    sid: "sid-1",
  };

  it("accepts a well-formed, correctly-signed token", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    const result = verifySessionToken(signToken(validPayload));
    expect(result).not.toBeNull();
    expect(result?.shopDomain).toBe("surasvenne.myshopify.com");
    expect(result?.userId).toBe("105276702777");
    expect(result?.sessionId).toBe("sid-1");
  });

  it("rejects a token with a bad signature", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    const tampered = signToken(validPayload).replace(/.$/, "x");
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(verifySessionToken(signToken({ ...validPayload, aud: "someone-else" }))).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(
      verifySessionToken(signToken({ ...validPayload, exp: nowSec - 120 })),
    ).toBeNull();
  });

  it("rejects a not-yet-valid token", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(
      verifySessionToken(signToken({ ...validPayload, nbf: nowSec + 120 })),
    ).toBeNull();
  });

  it("rejects a non-myshopify.com dest claim", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(
      verifySessionToken(
        signToken({ ...validPayload, dest: "https://evil.example.com" }),
      ),
    ).toBeNull();
  });

  it("rejects a malformed token (not three parts)", async () => {
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(verifySessionToken("not.a.jwt.token")).toBeNull();
    expect(verifySessionToken("onlyonepart")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });

  it("rejects when the env secret is missing", async () => {
    delete process.env.SHOPIFY_API_SECRET;
    const { verifySessionToken } = await import("@/lib/shopify/sessionToken");
    expect(verifySessionToken(signToken(validPayload))).toBeNull();
  });
});
