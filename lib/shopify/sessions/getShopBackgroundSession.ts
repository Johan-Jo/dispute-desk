import { loadSession, type StoredSession } from "../sessionStorage";

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

/** Loads the shop's offline session. Throws if missing. */
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
  console.log(
    `[shop-auth] mode=offline purpose=background shop=${shopId} sessionId=${session.id}`,
  );
  return session;
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
 * password`, `Access denied`). `userErrors` are NOT inspected — those
 * describe input problems, not auth.
 */
export function assertNotAuthInvalid(
  shopId: string,
  sessionType: "offline" | "online",
  response: {
    status?: number;
    errors?: Array<{ message?: string } | null | undefined> | null;
  },
): void {
  const authPattern = /invalid api key|unrecognized login|access denied|wrong password/i;

  if (response.status === 401) {
    throw new ShopifyAuthInvalidError(shopId, sessionType, `HTTP 401`);
  }

  const messages = (response.errors ?? [])
    .map((e) => (e && typeof e.message === "string" ? e.message : ""))
    .filter((m) => m.length > 0);

  const match = messages.find((m) => authPattern.test(m));
  if (match) {
    throw new ShopifyAuthInvalidError(shopId, sessionType, match);
  }
}
