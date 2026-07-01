import { getServiceClient } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/billing/consumePack";
import { FREE_LIFETIME_PACKS } from "@/lib/billing/plans";

/**
 * Grant the Free-tier lifetime pack floor once per shop.
 *
 * Idempotent: guards on an existing `free_lifetime` ledger row so
 * re-install / re-OAuth can't stack credits. Safe to call
 * fire-and-forget from the OAuth install path.
 *
 * `expiresAt: null` → the `pack_balance` view treats it as non-expiring,
 * and `checkPackQuota` scopes Free usage to lifetime via
 * `plan.packsLifetime`, so these N packs are a one-time floor rather than
 * a monthly grant.
 */
export async function grantFreeLifetimeCredits(shopId: string): Promise<void> {
  const sb = getServiceClient();
  const { data: existing } = await sb
    .from("pack_credits_ledger")
    .select("id")
    .eq("shop_id", shopId)
    .eq("source", "free_lifetime")
    .maybeSingle();
  if (existing) return; // already granted — never double-grant

  await grantCredits({
    shopId,
    source: "free_lifetime",
    packs: FREE_LIFETIME_PACKS,
    expiresAt: null,
    reference: `free-lifetime:${shopId}`,
  });
}
