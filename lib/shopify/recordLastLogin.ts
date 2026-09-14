/**
 * Records merchant "last login" activity on `shops` for the internal
 * admin Shops table. Called from app/(embedded)/app/layout.tsx on every
 * verified embedded (/app/*) page load.
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
 * Two constraints shape this:
 *   - Called from a page render — this must never block the merchant's
 *     page load on a write, and must not hit the DB on every single
 *     request (a merchant clicking around fires dozens of loads a
 *     minute). Throttled to ~once per LOGIN_THROTTLE_MS per shop via a
 *     cheap read-then-maybe-write, and the caller does not await this —
 *     it's fire-and-forget like persistShopCurrency.
 *   - The Shopify user id is free (already-verified JWT `sub` claim);
 *     resolving it to a name/email costs an extra Admin API call, so
 *     that resolution is skipped entirely when the throttle window
 *     hasn't elapsed, and is itself fire-and-forget from here.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchStaffMember } from "./staffMember";

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
  const nowIso = new Date().toISOString();

  const { data: shopRow } = await db
    .from("shops")
    .select("id, last_login_at, last_login_user_id, last_login_name, last_login_email")
    .eq("shop_domain", shopDomain)
    .maybeSingle();

  if (!shopRow) return;
  const shopInternalId = shopRow.id as string;

  const lastAt = shopRow?.last_login_at ? Date.parse(shopRow.last_login_at) : 0;
  const withinThrottle = Date.now() - lastAt < LOGIN_THROTTLE_MS;
  const sameUser = shopRow?.last_login_user_id === shopifyUserId;

  // Same user, recent login already recorded — nothing to do. A
  // different user within the window still gets the timestamp/id bump
  // (so a staff handoff isn't hidden for up to 5 minutes) but skips the
  // name/email re-resolution below to stay cheap.
  if (withinThrottle && sameUser) return;

  await db
    .from("shops")
    .update({
      last_login_at: nowIso,
      last_login_user_id: shopifyUserId,
    })
    .eq("id", shopInternalId);

  if (withinThrottle) return;

  // Best-effort name/email resolution — throttled independently of the
  // timestamp bump above since it costs a real Shopify API call. Null
  // result (missing scope consent, or Shopify error) intentionally
  // leaves prior values in place rather than blanking a good name.
  const staff = await fetchStaffMember(shopInternalId, shopifyUserId);
  if (staff?.name || staff?.email) {
    await db
      .from("shops")
      .update({
        ...(staff.name ? { last_login_name: staff.name } : {}),
        ...(staff.email ? { last_login_email: staff.email } : {}),
      })
      .eq("id", shopInternalId);
  }
}
