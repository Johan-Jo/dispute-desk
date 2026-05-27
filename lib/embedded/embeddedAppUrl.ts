/**
 * Build the embedded Shopify Admin URL for an app page.
 *
 * Used by billing callbacks (`/api/billing/callback`,
 * `/api/billing/topup-callback`) so Shopify's post-approval redirect
 * lands inside `admin.shopify.com/store/<handle>/apps/<api_key>/...`
 * rather than the bare `disputedesk.app/app/billing` URL. Without
 * this, the merchant returns to a page outside the Admin iframe —
 * App Bridge can't bootstrap and the `s-app-nav` chrome (Dashboard,
 * Disputes, Coverage, ...) renders as plain text instead of as the
 * embedded navigation. Reported 2026-05-27.
 *
 * The same trick is already used by the OAuth callback
 * (`app/api/auth/shopify/callback/route.ts`) which redirects via a
 * meta-refresh-style HTML page to the embedded URL.
 *
 * Input precedence (highest first):
 *   1. `host` — base64 of `<shop>.myshopify.com/admin` or
 *      `admin.shopify.com/store/<handle>`. App Bridge sends this on
 *      every embedded page load. Decode it to recover the store
 *      handle.
 *   2. `shop` — fully-qualified `<handle>.myshopify.com`. Fallback
 *      when host is missing (rare, but possible if the merchant
 *      bookmarked a deep link).
 *
 * Returns `null` when neither input yields a usable handle — caller
 * should fall back to the bare app URL.
 */

export interface BuildEmbeddedReturnUrlInput {
  /** Base64-encoded host param Shopify sends on embedded loads. */
  host?: string | null;
  /** Fully-qualified shop domain (`acme.myshopify.com`). */
  shop?: string | null;
  /** Path within the app, e.g. `/app/billing`. Must start with `/`. */
  appPath: string;
  /** Query params to attach to the final URL. */
  query?: Record<string, string>;
  /** Public Shopify API key (client_id of the app). Defaults to
   *  `process.env.SHOPIFY_API_KEY`. */
  apiKey?: string;
}

function decodeHost(host: string): string | null {
  try {
    // host is base64url; convert to standard base64 for atob/Buffer.
    const std = host.replace(/-/g, "+").replace(/_/g, "/");
    const decoded =
      typeof atob === "function"
        ? atob(std)
        : Buffer.from(std, "base64").toString("utf8");
    return decoded;
  } catch {
    return null;
  }
}

/** Extract the store handle (`acme` from `acme.myshopify.com`). */
function handleFromShop(shop: string): string | null {
  const cleaned = shop.trim().toLowerCase();
  const match = cleaned.match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/);
  return match ? match[1] : null;
}

/** Extract the store handle from a decoded `host` value. The decoded
 *  form is one of:
 *    - `<handle>.myshopify.com/admin`
 *    - `admin.shopify.com/store/<handle>`
 */
function handleFromDecodedHost(decoded: string): string | null {
  const lower = decoded.toLowerCase().trim();
  const adminMatch = lower.match(
    /(?:^|\/)admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/,
  );
  if (adminMatch) return adminMatch[1];
  const myshopifyMatch = lower.match(/^([a-z0-9][a-z0-9-]*)\.myshopify\.com/);
  if (myshopifyMatch) return myshopifyMatch[1];
  return null;
}

/**
 * Build the embedded Admin URL. Returns `null` when the store handle
 * cannot be derived — caller falls back to the bare app URL.
 */
export function buildEmbeddedReturnUrl(
  input: BuildEmbeddedReturnUrlInput,
): string | null {
  const apiKey = input.apiKey ?? process.env.SHOPIFY_API_KEY ?? "";
  if (!apiKey) return null;
  if (!input.appPath.startsWith("/")) return null;

  let handle: string | null = null;
  if (input.host) {
    const decoded = decodeHost(input.host);
    if (decoded) handle = handleFromDecodedHost(decoded);
  }
  if (!handle && input.shop) {
    handle = handleFromShop(input.shop);
  }
  if (!handle) return null;

  // admin.shopify.com expects the app path appended after the api key
  // with NO leading `/app` prefix collision — our app path is
  // `/app/billing` which becomes `.../apps/<api_key>/app/billing`.
  // That's the same shape OAuth callback uses (`.../apps/<api_key>`).
  const url = new URL(
    `https://admin.shopify.com/store/${handle}/apps/${apiKey}${input.appPath}`,
  );
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      url.searchParams.set(k, v);
    }
  }
  // Re-attach host so App Bridge inside the iframe has it without
  // needing to derive from `shop` again.
  if (input.host) url.searchParams.set("host", input.host);
  if (input.shop) url.searchParams.set("shop", input.shop);
  return url.toString();
}
