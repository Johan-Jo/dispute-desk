/**
 * SuperAdmin merchant impersonation ("View as merchant").
 *
 * A signed, short-TTL cookie lets a holder of an active `internal_admin_grant`
 * open the real embedded app (`/app/*`) as any merchant, WITHOUT a Shopify
 * session. The middleware reads this cookie, verifies its signature in the edge
 * runtime, and — when valid — short-circuits the Shopify-session cascade and
 * injects `x-shop-id` / `x-shop-domain` so every downstream data route filters
 * by the impersonated shop (they already read the header via `extractShopId`).
 *
 * Trust model:
 *  - The admin-grant check happens ONCE, at cookie-mint time, in the grant-gated
 *    `/api/admin/impersonate` route. The cookie payload embeds `adminUserId`.
 *  - Every request only re-verifies the HMAC + expiry — no DB round-trip. A
 *    revoked admin's cookie stops working within the TTL.
 *  - The payload is HMAC-SHA256 signed with `CRON_SECRET`. Verification MUST run
 *    in the edge runtime (middleware), so it uses Web Crypto (`crypto.subtle`),
 *    never `node:crypto` (edge has no `createHmac`).
 *
 * NEVER trust the cookie without a passing signature. NEVER let a `?shop_id=` /
 * `?shop=` query param override `payload.shopId` while impersonating.
 */

export const IMPERSONATION_COOKIE = "dd_impersonation";
export const IMPERSONATION_MODE_HEADER = "x-dd-impersonation-mode";

/**
 * Cookie lifetime. This is a SLIDING window: the middleware re-mints the cookie
 * with a fresh `iat` on every impersonated /app/* page load, so an actively-used
 * session never expires mid-debugging. The TTL only bites after this long of
 * genuine INACTIVITY (no navigation). Kept generous because losing it mid-session
 * previously rendered a misleading all-zeros merchant dashboard.
 */
export const IMPERSONATION_TTL_SECONDS = 8 * 60 * 60; // 8h idle cap

export type ImpersonationMode = "read" | "write";

export interface ImpersonationPayload {
  shopId: string;
  shopDomain: string;
  mode: ImpersonationMode;
  /** auth.users id of the admin who minted this cookie (for audit). */
  adminUserId: string;
  /** Issued-at, epoch seconds. */
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
      "CRON_SECRET is not set — required to sign impersonation cookies.",
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

/** Constant-time comparison of two byte arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Sign a payload into a `<body>.<sig>` cookie value. `body` is the
 * base64url-encoded JSON; `sig` is the base64url HMAC-SHA256 of `body`.
 */
export async function signImpersonation(
  payload: ImpersonationPayload,
): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const sig = toBase64Url(new Uint8Array(sigBuf));
  return `${body}.${sig}`;
}

/**
 * Verify a raw cookie value and return the payload, or `null` when the
 * signature fails, the format is malformed, or the payload has expired.
 * NEVER throws on bad input.
 */
export async function verifyImpersonationValue(
  raw: string | undefined | null,
): Promise<ImpersonationPayload | null> {
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
    const provided = fromBase64Url(sig);
    if (!timingSafeEqual(expected, provided)) return null;

    const json = decoder.decode(fromBase64Url(body));
    const payload = JSON.parse(json) as ImpersonationPayload;

    if (
      !payload ||
      typeof payload.shopId !== "string" ||
      typeof payload.shopDomain !== "string" ||
      (payload.mode !== "read" && payload.mode !== "write") ||
      typeof payload.iat !== "number"
    ) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - payload.iat > IMPERSONATION_TTL_SECONDS) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Edge-runtime helper: read + verify the impersonation cookie off a request.
 * `req` only needs a `.cookies.get(name)?.value` accessor (NextRequest).
 */
export async function verifyImpersonation(req: {
  cookies: { get(name: string): { value: string } | undefined };
}): Promise<ImpersonationPayload | null> {
  return verifyImpersonationValue(req.cookies.get(IMPERSONATION_COOKIE)?.value);
}

/**
 * Cookie attributes for the impersonation cookie.
 *
 * Impersonation ALWAYS runs in a top-level browser tab (ViewAsMerchant opens
 * `/app` via `window.open(..., "_blank")`) — never inside the Shopify Admin
 * iframe. So this must be a normal first-party cookie: `sameSite=lax`, NOT the
 * embedded cookies' `sameSite=none; partitioned` (CHIPS). A partitioned cookie
 * is keyed to the embedding context and is unreliably sent on top-level
 * same-origin navigations (e.g. a hard nav from a non-upgraded `<s-link>`),
 * which dropped the impersonation header mid-session and made the banner vanish
 * when navigating to pages like /app/insights/initial-analysis. `lax` is sent
 * on every top-level navigation to our origin.
 */
export function impersonationCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}
