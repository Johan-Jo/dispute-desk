import crypto from "crypto";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? "";
const SHOPIFY_SCOPES = process.env.SHOPIFY_SCOPES ?? "read_orders,read_shopify_payments_disputes,write_shopify_payments_dispute_evidences";
const SHOPIFY_APP_URL = process.env.SHOPIFY_APP_URL ?? "";

/**
 * Build the Shopify OAuth authorization URL.
 * @param shop - e.g. "my-store.myshopify.com"
 * @param isOnline - true for online (user-scoped) token, false for offline (shop-wide)
 */
export function buildAuthUrl(shop: string, state: string, isOnline: boolean = false): string {
  const redirectUri = `${SHOPIFY_APP_URL}/api/auth/shopify/callback`;
  const accessMode = isOnline ? "&grant_options[]=per-user" : "";

  return (
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${SHOPIFY_API_KEY}` +
    `&scope=${SHOPIFY_SCOPES}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}` +
    accessMode
  );
}

/**
 * Exchange the authorization code for an access token.
 */
export async function exchangeCodeForToken(
  shop: string,
  code: string
): Promise<{
  accessToken: string;
  scope: string;
  associatedUser?: {
    id: number;
    email: string;
    firstName: string;
    lastName: string;
  };
  expiresIn?: number;
}> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json();

  return {
    accessToken: data.access_token,
    scope: data.scope,
    associatedUser: data.associated_user
      ? {
          id: data.associated_user.id,
          email: data.associated_user.email,
          firstName: data.associated_user.first_name,
          lastName: data.associated_user.last_name,
        }
      : undefined,
    expiresIn: data.expires_in,
  };
}

/**
 * Verify the HMAC signature on the OAuth callback query string.
 */
export function verifyHmac(query: Record<string, string>): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;

  const sorted = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${rest[k]}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(sorted)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(hmac, "utf8")
    );
  } catch {
    return false;
  }
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Encode OAuth metadata into a signed state token.
 * Shopify passes the state param back verbatim on callback,
 * so we can recover phase/source/return_to without cookies.
 */
export function encodeOAuthState(data: {
  nonce: string;
  phase: string;
  source: string;
  returnTo: string;
}): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/**
 * Decode and verify a signed OAuth state token.
 * Returns null if the signature is invalid or data is malformed.
 */
export function decodeOAuthState(state: string): {
  nonce: string;
  phase: string;
  source: string;
  returnTo: string;
} | null {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);

  const expected = crypto
    .createHmac("sha256", SHOPIFY_API_SECRET)
    .update(payload)
    .digest("base64url");

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
