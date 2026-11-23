/**
 * Shopify IP-allowlist 403 handling (2026-11-23).
 *
 * Shopify now rejects Admin API requests made with an app's tokens from
 * sources that are not on the app's IP allowlist, answering HTTP 403. We have
 * never seen that body, so this module classifies on STATUS, not on wording.
 *
 * Why it must exist: before it, a 403 was read three different wrong ways —
 *  - GraphQL: a JSON body `{"errors":"Access denied"}` matched the
 *    auth-invalid pattern → non-retriable `shopify_auth_invalid`, plus a forced
 *    token refresh that 403s too; a non-JSON body threw a bare SyntaxError.
 *  - Dispute file upload: any 4xx except 408/429 was "a verdict on the file"
 *    → non-retriable `shopify_upload_rejected`.
 * Both silently and permanently failed a dispute save because of OUR network
 * address, not the merchant's token or file.
 *
 * Every 403 from Shopify is therefore tagged `[shopify-ip-403]` (one grep for
 * the whole fleet) and treated as retriable, unless the body is plainly a
 * scope/permission verdict.
 */

export const SHOPIFY_IP_403_TAG = "[shopify-ip-403]";

/** Bodies that are a genuine permission verdict, not a network-source block. */
const SCOPE_VERDICT_PATTERN =
  /requires merchant approval|required access scope|access scope|not approved|needs? the .* scope|merchant approval/i;

export class ShopifyIpNotAllowlistedError extends Error {
  readonly status = 403;
  readonly host: string;
  readonly path: string;
  readonly bodySnippet: string;
  constructor(host: string, path: string, bodySnippet: string) {
    super(
      `${SHOPIFY_IP_403_TAG} Shopify answered 403 for ${host}${path}: ` +
        `${bodySnippet || "(empty body)"} — likely this server's IP is not on the app's IP allowlist`,
    );
    this.name = "ShopifyIpNotAllowlistedError";
    this.host = host;
    this.path = path;
    this.bodySnippet = bodySnippet;
  }
}

/** True when a 403 should be treated as a possible allowlist block. */
export function isPossibleAllowlist403(status: number, body: string): boolean {
  return status === 403 && !SCOPE_VERDICT_PATTERN.test(body);
}

/** Never includes the token: only status, host, path and a short body prefix. */
export function logShopifyIp403(ctx: {
  host: string;
  path: string;
  body: string;
  correlationId?: string;
}): void {
  console.warn(`${SHOPIFY_IP_403_TAG} status=403 host=${ctx.host} path=${ctx.path}`, {
    body: ctx.body.slice(0, 500),
    correlationId: ctx.correlationId,
  });
}

function splitUrl(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.host, path: u.pathname };
  } catch {
    return { host: "unknown", path: url.slice(0, 120) };
  }
}

/**
 * Build the typed error (and log it) for a 403 response whose body has already
 * been read. Returns null when the body is a scope verdict — the caller then
 * continues with its normal 4xx handling.
 */
export function classifyShopify403(
  url: string,
  body: string,
  correlationId?: string,
): ShopifyIpNotAllowlistedError | null {
  if (!isPossibleAllowlist403(403, body)) return null;
  const { host, path } = splitUrl(url);
  logShopifyIp403({ host, path, body, correlationId });
  return new ShopifyIpNotAllowlistedError(host, path, body.slice(0, 500));
}
