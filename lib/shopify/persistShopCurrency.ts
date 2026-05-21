/**
 * Fetch the Shopify shop's primary/presentment currency and persist
 * it to `shops.currency_code`. Used by:
 *
 *   - OAuth callback (offline phase) — populates currency on first install
 *   - Token-exchange (embedded re-auth) — populates currency if missing
 *   - shop/update webhook — refreshes currency if the merchant changed it
 *
 * Idempotent and safe to fire-and-forget. Failures are logged and
 * swallowed — a missing `currency_code` falls back to the legacy
 * most-frequent-dispute-currency heuristic in
 * `lib/disputes/metrics.ts`, so failure here is graceful degradation,
 * not a broken install.
 *
 * The Shop query needs an offline session, so this helper MUST be
 * called AFTER `storeSession`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "./shopDetails";

export async function persistShopCurrency(
  shopInternalId: string,
): Promise<{ ok: boolean; currencyCode: string | null }> {
  try {
    const details = await fetchShopDetails(shopInternalId);
    if (!details?.currencyCode) {
      return { ok: false, currencyCode: null };
    }

    const db = getServiceClient();
    const { error } = await db
      .from("shops")
      .update({ currency_code: details.currencyCode })
      .eq("id", shopInternalId);

    if (error) {
      console.warn(
        "[persistShopCurrency] update failed",
        { shopInternalId, message: error.message },
      );
      return { ok: false, currencyCode: details.currencyCode };
    }

    return { ok: true, currencyCode: details.currencyCode };
  } catch (err) {
    console.warn(
      "[persistShopCurrency] fetch/update threw",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, currencyCode: null };
  }
}
