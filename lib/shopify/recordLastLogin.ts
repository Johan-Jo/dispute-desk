/**
 * Records merchant "last login" activity on `shops` for the internal
 * admin Shops table. Called from app/(embedded)/app/layout.tsx on every
 * verified embedded (/app/*) page load.
 *
 * Records WHEN a shop was last active, not WHO was using it. Resolving
 * the session token's numeric staff id to a name/email needs Shopify's
 * `staffMember` query, which is gated behind the `read_users` scope —
 * adding that scope would change the consent set on the live app and
 * push already-installed merchants through a re-auth, which is not a
 * risk worth taking for a display name (a re-auth that lands on the
 * legacy OAuth callback mints a non-expiring token that Shopify now
 * rejects outright — see docs/technical.md § Expiring Offline Tokens).
 * So nothing here calls the Admin API at all.
 *
 * Takes `shopDomain` (not an internal shop id) and resolves it here:
 * middleware.ts's `/app/*` branch never resolves shops.id into a
 * request header on the normal cookie-authenticated path (only the
 * `/api/*` branch and the impersonation branches do, via `x-shop-id`)
 * — that gap meant an earlier version of this taking `shopInternalId`
 * silently no-op'd on every real merchant page load. `shopDomain` comes
 * straight from the verified session token instead, so it doesn't
 * depend on which middleware branch a given request took.
 *
 * Called from a page render, so it must never block the merchant's page
 * load on a write, and must not hit the DB on every single request (a
 * merchant clicking around fires dozens of loads a minute). Throttled
 * to ~once per LOGIN_THROTTLE_MS per shop via a cheap
 * read-then-maybe-write, and the caller does not await this — it's
 * fire-and-forget like persistShopCurrency.
 */

import { getServiceClient } from "@/lib/supabase/server";

const LOGIN_THROTTLE_MS = 5 * 60 * 1000;

export function recordLastLogin(
  shopDomain: string,
  shopifyUserId: string,
): void {
  void recordLastLoginAsync(shopDomain, shopifyUserId).catch((err) => {
    console.warn(
      "[recordLastLogin] failed",
      err instanceof Error ? err.message : err,
    );
  });
}

async function recordLastLoginAsync(
  shopDomain: string,
  shopifyUserId: string,
): Promise<void> {
  const db = getServiceClient();

  const { data: shopRow } = await db
    .from("shops")
    .select("id, last_login_at, last_login_user_id")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shopRow) return;

  const lastAt = shopRow.last_login_at ? Date.parse(shopRow.last_login_at) : 0;
  const withinThrottle = Date.now() - lastAt < LOGIN_THROTTLE_MS;
  const sameUser = shopRow.last_login_user_id === shopifyUserId;

  // Same user, recent login already recorded — nothing to do. A
  // different user within the window still gets the bump, so a staff
  // handoff isn't hidden for up to 5 minutes.
  if (withinThrottle && sameUser) return;

  await db
    .from("shops")
    .update({
      last_login_at: new Date().toISOString(),
      last_login_user_id: shopifyUserId,
    })
    .eq("id", shopRow.id);
}
