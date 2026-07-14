/**
 * Expiring offline token refresh (docs/plans/expiring-offline-tokens.plan.md
 * Stage 2). Shopify's expiring offline tokens are 1-hour access tokens
 * backed by a 90-day refresh token; this module keeps a session's access
 * token fresh transparently before any background Admin API call.
 *
 * Legacy (non-expiring, `tokenExpiring: false`) sessions are left
 * untouched — refreshing is only defined for the expiring variant, and a
 * legacy session has no refresh_token to exchange anyway. Those sessions
 * are upgraded separately, on embedded load
 * (app/api/auth/shopify/token-exchange/route.ts Stage 3).
 */

import { getServiceClient } from "@/lib/supabase/server";
import {
  loadSession,
  updateSessionTokens,
  type StoredSession,
} from "../sessionStorage";

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY ?? "";
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET ?? "";

/** Refresh when the access token is within this window of expiring (or
 *  already expired) — leaves headroom for clock skew + in-flight calls. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** A refresh claim older than this is presumed abandoned (crashed
 *  worker, timed-out request) and can be re-claimed. */
const CLAIM_STALE_MS = 30_000;

/** Best-effort backoff when another instance holds the claim. */
const CLAIM_WAIT_MS = 400;

export class TokenRefreshFailedError extends Error {
  readonly shopId: string;
  constructor(shopId: string, detail: string) {
    super(`Shopify refresh_token exchange failed for shop ${shopId}: ${detail}`);
    this.name = "TokenRefreshFailedError";
    this.shopId = shopId;
  }
}

export function needsRefresh(session: StoredSession): boolean {
  if (!session.tokenExpiring) return false;
  if (!session.expiresAt) return false;
  return Date.parse(session.expiresAt) - Date.now() < REFRESH_SKEW_MS;
}

interface ShopifyRefreshResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  refresh_token: string;
  refresh_token_expires_in: number;
}

async function exchangeRefreshToken(
  shopDomain: string,
  refreshToken: string,
): Promise<ShopifyRefreshResponse> {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<ShopifyRefreshResponse>;
}

/**
 * Optimistic per-row claim so two concurrent background jobs for the
 * same shop don't both call Shopify's refresh endpoint with the same
 * (single-use, rotating) refresh_token — the loser's exchange would
 * fail because the winner already rotated it away. Returns true when
 * this caller won the claim.
 */
async function claimRefresh(sessionId: string): Promise<boolean> {
  const db = getServiceClient();
  const staleCutoff = new Date(Date.now() - CLAIM_STALE_MS).toISOString();
  const nowIso = new Date().toISOString();
  const { data } = await db
    .from("shop_sessions")
    .update({ refresh_claimed_at: nowIso })
    .eq("id", sessionId)
    .or(`refresh_claimed_at.is.null,refresh_claimed_at.lt.${staleCutoff}`)
    .select("id");
  return !!data && data.length > 0;
}

/**
 * Returns a session guaranteed to carry a live access token: refreshes
 * in place when the stored token is expiring-variant and near/at expiry.
 * No-ops for legacy (non-expiring) sessions and for sessions that still
 * have headroom, unless `force: true` — used by the reactive
 * refresh-and-retry in `makeAuthedRequest` after an auth-invalid
 * response, to cover clock skew / early Shopify-side expiry (the
 * proactive skew window is 5 minutes; `force` refreshes regardless of
 * `expiresAt`). Never throws — on any failure (Shopify rejects the
 * refresh, DB write fails) it logs and returns the original session so
 * the caller's own auth-error handling (assertNotAuthInvalid) takes
 * over rather than this helper masking the failure.
 */
export async function ensureFreshSession(
  session: StoredSession,
  opts: { force?: boolean } = {},
): Promise<StoredSession> {
  if (!opts.force && !needsRefresh(session)) return session;
  if (!session.tokenExpiring) return session;

  if (!session.refreshToken) {
    // token_expiring=true with no stored refresh token is a data bug,
    // not a normal state — fall through rather than throw here.
    console.warn(
      `[shopify-auth] session ${session.id} is token_expiring but has no refresh_token`,
    );
    return session;
  }

  const won = await claimRefresh(session.id);
  if (!won) {
    // Another instance is refreshing (or just finished). Best-effort
    // re-read once rather than racing Shopify ourselves.
    await new Promise((r) => setTimeout(r, CLAIM_WAIT_MS));
    const fresh = await loadSession(session.shopId, session.sessionType);
    return fresh ?? session;
  }

  try {
    const data = await exchangeRefreshToken(session.shopDomain, session.refreshToken);
    const now = Date.now();
    const updated = await updateSessionTokens(session.id, {
      accessToken: data.access_token,
      scopes: data.scope,
      expiresAt: new Date(now + data.expires_in * 1000).toISOString(),
      refreshToken: data.refresh_token,
      refreshTokenExpiresAt: new Date(
        now + data.refresh_token_expires_in * 1000,
      ).toISOString(),
      tokenExpiring: true,
    });
    if (!updated) {
      console.error(
        `[shopify-auth] refresh succeeded but persisting session ${session.id} failed`,
      );
      return session;
    }
    return updated;
  } catch (err) {
    console.error(
      `[shopify-auth] token refresh failed for shop ${session.shopId}:`,
      err instanceof Error ? err.message : err,
    );
    return session;
  }
}
