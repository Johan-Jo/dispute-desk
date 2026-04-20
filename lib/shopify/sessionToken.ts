import crypto from "crypto";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? "";

export interface VerifiedSessionToken {
  shopDomain: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}

function base64UrlDecode(input: string): Buffer {
  const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Verify a Shopify session token (id_token) from the embedded app load.
 *
 * The token is an HS256 JWT signed with the app's client secret. Shopify's
 * Managed Installation and App Bridge both attach it on every embedded
 * request so the server can authenticate without relying on cookies —
 * essential for iOS Shopify mobile app WebViews where third-party cookies
 * are often blocked.
 *
 * Validates: HS256 signature, `aud` matches our client_id, `exp`/`nbf`
 * window, `dest` claim is a .myshopify.com URL. Returns null on any
 * failure (never throws — callers treat null as unauthenticated).
 */
export function verifySessionToken(token: string): VerifiedSessionToken | null {
  if (!SHOPIFY_API_SECRET || !SHOPIFY_API_KEY) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  let payload: {
    iss?: string;
    dest?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    nbf?: number;
    sid?: string;
  };
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  if (header.alg !== "HS256" || header.typ !== "JWT") return null;
  if (payload.aud !== SHOPIFY_API_KEY) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const clockSkew = 5;
  if (typeof payload.exp !== "number" || payload.exp < nowSec - clockSkew) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + clockSkew) return null;

  const expectedSig = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actualSig = base64UrlDecode(sigB64);
  if (!constantTimeEqual(expectedSig, actualSig)) return null;

  // `dest` is "https://<shop>.myshopify.com"; extract the bare host.
  const destUrl = payload.dest ?? "";
  const shopMatch = destUrl.match(/^https?:\/\/([a-z0-9][a-z0-9-]*\.myshopify\.com)$/i);
  if (!shopMatch) return null;

  if (!payload.sub || !payload.sid) return null;

  return {
    shopDomain: shopMatch[1].toLowerCase(),
    userId: payload.sub,
    sessionId: payload.sid,
    expiresAt: payload.exp,
  };
}

/**
 * Cheap format check suitable for edge middleware (no crypto). A token
 * passing this will still be cryptographically verified by the
 * token-exchange route in the nodejs runtime before any trust decision.
 */
export function looksLikeSessionToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}
