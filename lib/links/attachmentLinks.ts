/**
 * HMAC-signed tokens for public, bank-facing evidence-attachment URLs.
 *
 * NOTE (2026-04-25): Legacy / verifier-only. New code mints
 * DB-backed short codes via `lib/links/shortLinks.ts` because the
 * HMAC envelope below produces ~220-char URLs that are visually noisy
 * in bank-facing evidence text. The route handler at
 * `app/e/[token]/route.ts` keeps the verifier wired in as a fallback
 * so live tokens already submitted to Shopify continue to work
 * through their 180-day TTL. After that window the signing helpers
 * here become dead code and can be deleted.
 *
 * Issues tokens of shape `<base64url(payload)>.<base64url(hmac)>` that
 * are embedded in URLs on our canonical origin (e.g.
 * `https://disputedesk.app/e/<token>`). Payload carries the target
 * object identifier and an absolute unix-seconds expiry; the HMAC
 * signature — keyed by `EVIDENCE_LINK_SECRET` — prevents holders from
 * forging or tampering with the identifier or extending the expiry.
 *
 * This is an authentication-free link model. Confidentiality is the
 * same class as a Supabase signed URL: anyone in possession of the
 * link can fetch. The guarantee this module provides is integrity
 * (token can't be forged) and time-bounded validity (token can't
 * outlive `exp`). Per-reviewer auth is not practical because issuing
 * banks don't have accounts with us.
 *
 * Kept pure except for `buildAttachmentUrl` (reads the app's public
 * base URL) and `requireEvidenceLinkSecret` (reads
 * `EVIDENCE_LINK_SECRET`). The sign/verify helpers take the secret
 * explicitly so they are side-effect free and easy to unit-test.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getPublicBaseUrl } from "@/lib/resources/url";

/** Default TTL for bank-facing links. */
export const ATTACHMENT_LINK_TTL_DAYS = 180;

export type AttachmentKind = "item" | "pdf";

export interface AttachmentTokenPayload {
  /** Target kind: "item" → evidence_items row; "pdf" → pack PDF. */
  k: AttachmentKind;
  /** Target row id (evidence_items.id for "item", pack id for "pdf"). */
  id: string;
  /** Pack id — defence-in-depth cross-check at download time. */
  p: string;
  /** Absolute unix-seconds expiry. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

/**
 * Read and validate `EVIDENCE_LINK_SECRET`. Throws when the secret is
 * missing or shorter than 32 chars. Callers that perform env access
 * should delegate to this function rather than touching `process.env`
 * directly.
 */
export function requireEvidenceLinkSecret(): string {
  const s = process.env.EVIDENCE_LINK_SECRET;
  if (!s || s.length < 32) {
    throw new Error(
      "EVIDENCE_LINK_SECRET is not set (or too short: must be ≥32 chars).",
    );
  }
  return s;
}

/**
 * Sign a payload with the given secret and return the compact token.
 * Pure: no env access, no I/O. Throws if the secret is missing or too
 * short so upstream misuse is loud rather than silent.
 */
export function signAttachmentToken(
  payload: AttachmentTokenPayload,
  secret: string,
): string {
  if (!secret || secret.length < 32) {
    throw new Error("signAttachmentToken: secret missing or too short");
  }
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}

/**
 * Verify a token against the given secret. Returns `null` on any
 * failure (bad format, bad signature, expired, malformed payload,
 * wrong secret). Never throws — callers treat `null` as "deny".
 */
export function verifyAttachmentToken(
  token: string,
  secret: string,
): AttachmentTokenPayload | null {
  if (!secret || secret.length < 32) return null;
  if (typeof token !== "string" || token.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expected = createHmac("sha256", secret).update(payloadB64).digest();
  let actual: Buffer;
  try {
    actual = b64urlDecode(sigB64);
  } catch {
    return null;
  }
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const p = parsed as Record<string, unknown>;
  if (p.k !== "item" && p.k !== "pdf") return null;
  if (typeof p.id !== "string" || p.id.length === 0) return null;
  if (typeof p.p !== "string" || p.p.length === 0) return null;
  if (typeof p.exp !== "number" || !Number.isFinite(p.exp)) return null;
  if (p.exp <= Math.floor(Date.now() / 1000)) return null;

  return { k: p.k, id: p.id, p: p.p, exp: p.exp };
}

/**
 * Build the full bank-facing URL for an attachment token. Resolves
 * origin via `getPublicBaseUrl()` so preview deployments and overrides
 * follow the same rules as the rest of the app.
 */
export function buildAttachmentUrl(token: string): string {
  const base = getPublicBaseUrl().replace(/\/$/, "");
  return `${base}/e/${token}`;
}
