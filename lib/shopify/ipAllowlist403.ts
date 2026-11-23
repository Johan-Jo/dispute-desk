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
 * Every 403 is therefore tagged `[shopify-ip-403]` (one grep for the whole
 * fleet) and treated as retriable, unless the body is plainly a scope or
 * permission verdict.
 *
 * LOGGING CONTRACT: nothing from Shopify's response body is ever logged or put
 * in an error message — a body can echo merchant data or request details. Only
 * structured, non-sensitive fields are emitted: status, classification, shop
 * host, the endpoint with numeric ids masked, an optional correlation id, and
 * the body's size and coarse kind (so a first real allowlist response can be
 * recognised without its content being stored).
 */

export const SHOPIFY_IP_403_TAG = "[shopify-ip-403]";

/** Machine class carried by the log line and the typed error. */
export const SHOPIFY_IP_403_CLASS = "possible_ip_allowlist_403";

/** Bodies that are a genuine permission verdict, not a network-source block. */
const SCOPE_VERDICT_PATTERN =
  /requires merchant approval|required access scope|access scope|not approved|needs? the .* scope|merchant approval/i;

export type Shopify403BodyKind = "empty" | "json" | "html" | "text";

export interface Shopify403Details {
  status: 403;
  classification: typeof SHOPIFY_IP_403_CLASS;
  shop: string;
  endpoint: string;
  bodyBytes: number;
  bodyKind: Shopify403BodyKind;
  correlationId?: string;
}

export class ShopifyIpNotAllowlistedError extends Error {
  readonly status = 403;
  readonly classification = SHOPIFY_IP_403_CLASS;
  readonly shop: string;
  readonly endpoint: string;
  readonly bodyBytes: number;
  readonly bodyKind: Shopify403BodyKind;
  constructor(d: Pick<Shopify403Details, "shop" | "endpoint" | "bodyBytes" | "bodyKind">) {
    // No response-body text: see the logging contract above.
    super(
      `${SHOPIFY_IP_403_TAG} Shopify answered 403 for ${d.shop} ${d.endpoint} ` +
        `(${d.bodyKind}, ${d.bodyBytes} bytes) — likely this server's IP is not on the app's IP allowlist`,
    );
    this.name = "ShopifyIpNotAllowlistedError";
    this.shop = d.shop;
    this.endpoint = d.endpoint;
    this.bodyBytes = d.bodyBytes;
    this.bodyKind = d.bodyKind;
  }
}

/** True when a 403 should be treated as a possible allowlist block. */
export function isPossibleAllowlist403(status: number, body: string): boolean {
  return status === 403 && !SCOPE_VERDICT_PATTERN.test(body);
}

function bodyKindOf(body: string): Shopify403BodyKind {
  const t = body.trimStart();
  if (t.length === 0) return "empty";
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return "html";
  return "text";
}

/** Mask numeric ids so a merchant's dispute/order id never reaches the logs. */
function maskedEndpoint(pathname: string): string {
  return pathname.replace(/\/\d+(?=\/|\.|$)/g, "/:id");
}

function splitUrl(url: string): { shop: string; endpoint: string } {
  try {
    const u = new URL(url);
    return { shop: u.host, endpoint: maskedEndpoint(u.pathname) };
  } catch {
    return { shop: "unknown", endpoint: "unknown" };
  }
}

/**
 * Build the typed error (and emit one structured log line) for a 403 response
 * whose body has already been read. Returns null when the body is a scope
 * verdict — the caller then continues with its normal 4xx handling.
 */
export function classifyShopify403(
  url: string,
  body: string,
  correlationId?: string,
): ShopifyIpNotAllowlistedError | null {
  if (!isPossibleAllowlist403(403, body)) return null;
  const { shop, endpoint } = splitUrl(url);
  const details: Shopify403Details = {
    status: 403,
    classification: SHOPIFY_IP_403_CLASS,
    shop,
    endpoint,
    bodyBytes: body.length,
    bodyKind: bodyKindOf(body),
    ...(correlationId ? { correlationId } : {}),
  };
  console.warn(SHOPIFY_IP_403_TAG, JSON.stringify(details));
  return new ShopifyIpNotAllowlistedError(details);
}
