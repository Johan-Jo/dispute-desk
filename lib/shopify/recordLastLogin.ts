/**
 * Records merchant "last login" activity on `shops` for the internal
 * admin Shops table. Called from middleware.ts on every verified
 * embedded (/app/*) page load.
 *
 * Two constraints shape this:
 *   - Middleware is a per-request hot path — this must never block the
 *     merchant's page load on a write, and must not hit the DB on every
 *     single request (a merchant clicking around fires dozens of loads
 *     a minute). Throttled to ~once per LOGIN_THROTTLE_MS per shop via a
 *     cheap read-then-maybe-write, and the caller in middleware.ts does
 *     not await this — it's fire-and-forget like persistShopCurrency.
 *   - The Shopify user id is free (already-verified JWT `sub` claim);
 *     resolving it to a name/email costs an extra Admin API call, so
 *     that resolution is skipped entirely when the throttle window
 *     hasn't elapsed, and is itself fire-and-forget from here.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchStaffMember } from "./staffMember";

const LOGIN_THROTTLE_MS = 5 * 60 * 1000;

export function recordLastLogin(
  shopInternalId: string,
  shopifyUserId: string,
): void {
  void recordLastLoginAsync(shopInternalId, shopifyUserId).catch((err) => {
    console.warn(
      "[recordLastLogin] failed",
      err instanceof Error ? err.message : err,
    );
  });
}

async function recordLastLoginAsync(
  shopInternalId: string,
  shopifyUserId: string,
): Promise<void> {
  const db = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: shopRow } = await db
    .from("shops")
    .select("last_login_at, last_login_user_id, last_login_name, last_login_email")
    .eq("id", shopInternalId)
    .maybeSingle();

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
