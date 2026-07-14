import { loadSession, type StoredSession } from "../sessionStorage";
import { ensureFreshSession } from "./refreshOfflineToken";

/**
 * Single source of truth for background/worker Shopify session lookup.
 *
 * Policy: background jobs (worker handlers, cron, any code path the
 * merchant is NOT actively interacting with) MUST use the durable
 * offline (shop-context) session. Online sessions are user-scoped and
 * expire on a ~24h window — they're fine for interactive UI requests
 * but wrong for anything long-running.
 *
 * This helper enforces that:
 *   - Returns the offline session when one exists.
 *   - Throws `NoBackgroundSessionError` when there isn't one, rather
 *     than silently falling back to whatever else is in the table.
 *   - Never returns an online session from a "background" code path.
 *
 * Verified 2026-04-21: offline tokens can successfully call
 * Shopify's `disputeEvidenceUpdate` mutation. The old claim that
 * this specific mutation "requires ONLINE session" is NOT supported
 * by the actual Shopify API response (see
 * scripts/verify-offline-evidence-update.mjs).
 */

export class NoBackgroundSessionError extends Error {
  readonly shopId: string;
  constructor(shopId: string) {
    super(`No offline session row for shop ${shopId}. Merchant must (re)install the app.`);
    this.name = "NoBackgroundSessionError";
    this.shopId = shopId;
  }
}

export class ShopifyAuthInvalidError extends Error {
  readonly shopId: string;
  readonly sessionType: "offline" | "online";
  readonly rawMessage: string;
  constructor(shopId: string, sessionType: "offline" | "online", rawMessage: string) {
    super(`Shopify rejected the ${sessionType} token for shop ${shopId}: ${rawMessage}`);
    this.name = "ShopifyAuthInvalidError";
    this.shopId = shopId;
    this.sessionType = sessionType;
    this.rawMessage = rawMessage;
  }
}

/**
 * Loads the shop's offline session. Throws if missing.
 *
 * Expiring-token sessions (docs/plans/expiring-offline-tokens.plan.md)
 * are proactively refreshed here when near/at expiry — this is the
 * single choke point most background code funnels through
 * (`makeAuthedRequest` and every direct caller), so refreshing here
 * covers the large majority of Shopify Admin API traffic without
 * touching individual call sites. Legacy (non-expiring) sessions pass
 * through unchanged; they're upgraded separately on embedded load.
 */
export async function getShopBackgroundSession(shopId: string): Promise<StoredSession> {
  const session = await loadSession(shopId, "offline");
  if (!session) {
    throw new NoBackgroundSessionError(shopId);
  }
  // Defense-in-depth: if somehow loadSession returns an online row for an
  // offline query (shouldn't be possible per sessionStorage.ts:93-95), refuse.
  if (session.sessionType !== "offline") {
    throw new NoBackgroundSessionError(shopId);
  }
  const fresh = await ensureFreshSession(session);
  console.log(
    `[shop-auth] mode=offline purpose=background shop=${shopId} sessionId=${fresh.id} tokenExpiring=${fresh.tokenExpiring}`,
  );
  return fresh;
}

const AUTH_INVALID_PATTERN =
  /invalid api key|unrecognized login|access denied|wrong password|non-expiring access tokens/i;

/**
 * Non-throwing version of the same detection `assertNotAuthInvalid`
 * uses — returns the matched reason (or null). Used by
 * `makeAuthedRequest`'s reactive refresh-and-retry, which needs to
 * inspect the response without unwinding the stack.
 */
export function detectAuthInvalidReason(response: {
  status?: number;
  errors?: Array<{ message?: string } | null | undefined> | null;
}): string | null {
  if (response.status === 401) return "HTTP 401";
  const messages = (response.errors ?? [])
    .map((e) => (e && typeof e.message === "string" ? e.message : ""))
    .filter((m) => m.length > 0);
  return messages.find((m) => AUTH_INVALID_PATTERN.test(m)) ?? null;
}

/**
 * Narrow auth-error detector. Call right after a Shopify GraphQL/HTTP
 * response to distinguish auth-invalidation from other error shapes.
 *
 * Throws `ShopifyAuthInvalidError` on match. Returns void on no-match so
 * the caller can proceed with its own error handling for userErrors,
 * throttles, field validation, etc.
 *
 * Matches: HTTP 401, or any top-level GraphQL `errors[].message` that
 * contains the Shopify auth-invalid vocabulary we've observed in prod
 * (`Invalid API key or access token`, `unrecognized login or wrong
 * password`, `Access denied`, the legacy-non-expiring-token rejection).
 * `userErrors` are NOT inspected — those describe input problems, not
 * auth.
 */
export function assertNotAuthInvalid(
  shopId: string,
  sessionType: "offline" | "online",
  response: {
    status?: number;
    errors?: Array<{ message?: string } | null | undefined> | null;
  },
): void {
  const reason = detectAuthInvalidReason(response);
  if (reason) {
    throw new ShopifyAuthInvalidError(shopId, sessionType, reason);
  }
}
