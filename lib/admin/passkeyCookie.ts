/**
 * Signed cookies for the custom-WebAuthn admin second factor.
 *
 * Two cookies, both HMAC-SHA256 signed with `CRON_SECRET` and verifiable in the
 * edge runtime via Web Crypto (never `node:crypto`) — the exact proven shape of
 * `lib/admin/impersonation.ts`:
 *
 *  - `dd_admin_passkey`        — proof that THIS admin session completed a passkey
 *                                assertion. The middleware admin gates require it
 *                                (after Supabase session + active grant). Short
 *                                TTL, refreshed on each successful verify.
 *  - `dd_admin_webauthn_chal`  — the per-ceremony WebAuthn challenge, bound to the
 *                                user + ceremony kind. Issued by the challenge
 *                                endpoint, read back (and cleared) by the verify
 *                                endpoint. Stateless challenge storage — the
 *                                challenge is NEVER trusted from the client body.
 *
 * NEVER trust either cookie without a passing signature. The admin-grant check
 * happens per request in middleware as today; this only adds the passkey factor.
 */

export const PASSKEY_COOKIE = "dd_admin_passkey";
export const WEBAUTHN_CHALLENGE_COOKIE = "dd_admin_webauthn_chal";

/** Passkey-verified session lifetime. Re-minted on each successful assertion. */
export const PASSKEY_TTL_SECONDS = 12 * 60 * 60; // 12h — one working session
/** WebAuthn challenge lifetime — a single ceremony round trip. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

export interface PasskeyVerifiedPayload {
  /** auth.users id of the verified admin. */
  userId: string;
  /** credential_id (base64url) that satisfied the assertion. */
  credentialId: string;
  /** Issued-at, epoch seconds. */
  iat: number;
}

export interface WebauthnChallengePayload {
  userId: string;
  /** base64url challenge issued to the browser. */
  challenge: string;
  kind: "reg" | "auth";
  iat: number;
}

// ─── base64url (edge-safe, no Buffer) ──────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function signingSecret(): string {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error(
      "CRON_SECRET is not set — required to sign admin passkey cookies.",
    );
  }
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sign(payload: unknown): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(sigBuf))}`;
}

async function verify<T>(raw: string | undefined | null): Promise<T | null> {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!body || !sig) return null;
  try {
    const key = await hmacKey();
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
    );
    if (!timingSafeEqual(expected, fromBase64Url(sig))) return null;
    return JSON.parse(decoder.decode(fromBase64Url(body))) as T;
  } catch {
    return null;
  }
}

// ─── passkey-verified cookie ───────────────────────────────────────────────

export function signPasskeyVerified(
  payload: PasskeyVerifiedPayload,
): Promise<string> {
  return sign(payload);
}

export async function verifyPasskeyValue(
  raw: string | undefined | null,
): Promise<PasskeyVerifiedPayload | null> {
  const p = await verify<PasskeyVerifiedPayload>(raw);
  if (
    !p ||
    typeof p.userId !== "string" ||
    typeof p.credentialId !== "string" ||
    typeof p.iat !== "number"
  ) {
    return null;
  }
  if (Math.floor(Date.now() / 1000) - p.iat > PASSKEY_TTL_SECONDS) return null;
  return p;
}

/** Edge helper: read + verify the passkey-verified cookie off a request. */
export function verifyPasskeyCookie(req: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<PasskeyVerifiedPayload | null> {
  return verifyPasskeyValue(req.cookies.get(PASSKEY_COOKIE)?.value);
}

// ─── webauthn challenge cookie ─────────────────────────────────────────────

export function signChallenge(
  payload: WebauthnChallengePayload,
): Promise<string> {
  return sign(payload);
}

export async function verifyChallengeValue(
  raw: string | undefined | null,
): Promise<WebauthnChallengePayload | null> {
  const p = await verify<WebauthnChallengePayload>(raw);
  if (
    !p ||
    typeof p.userId !== "string" ||
    typeof p.challenge !== "string" ||
    (p.kind !== "reg" && p.kind !== "auth") ||
    typeof p.iat !== "number"
  ) {
    return null;
  }
  if (Math.floor(Date.now() / 1000) - p.iat > CHALLENGE_TTL_SECONDS) return null;
  return p;
}

// ─── cookie attributes (mirror the embedded/impersonation cookies, CHIPS) ──

export function passkeyCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none" as const,
    partitioned: true,
    path: "/",
    maxAge,
  };
}
