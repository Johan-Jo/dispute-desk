/**
 * Fetch the Shopify shop's profile and persist the durable bits —
 * primary/presentment currency to `shops.currency_code`, and the
 * merchant-facing store name to `shops.shop_name`. Used by:
 *
 *   - OAuth callback (offline phase) — populates currency on first install
 *   - Token-exchange (embedded re-auth) — populates currency if missing
 *   - shop/update webhook — refreshes currency if the merchant changed it
 *
 * `shop_name` matters because `shops.shop_domain` is only the myshopify
 * subdomain — `6a8848-dd` for a store actually called "Mein Maison". Without
 * persisting it, merchant-facing copy (the install welcome email) has nothing
 * but the opaque subdomain to greet the merchant with, and recovering the real
 * name later needs a live Admin call with an offline token that may since have
 * expired or been revoked. The shop/update webhook call site means a rename
 * propagates on its own.
 *
 * Idempotent and safe to fire-and-forget. Failures are logged and
 * swallowed — a missing `currency_code` falls back to the legacy
 * most-frequent-dispute-currency heuristic in
 * `lib/disputes/metrics.ts`, and a missing `shop_name` degrades the
 * greeting rather than blocking the email, so failure here is graceful
 * degradation, not a broken install.
 *
 * The Shop query needs an offline session, so this helper MUST be
 * called AFTER `storeSession`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "./shopDetails";

export async function persistShopCurrency(
  shopInternalId: string,
): Promise<{ ok: boolean; currencyCode: string | null; shopName: string | null }> {
  try {
    const details = await fetchShopDetails(shopInternalId);
    if (!details) {
      return { ok: false, currencyCode: null, shopName: null };
    }

    const currencyCode = details.currencyCode ?? null;
    const shopName = details.name?.trim() || null;

    // Write only what Shopify actually returned, so a partial response can
    // never blank a column that already holds a good value.
    const patch: { currency_code?: string; shop_name?: string } = {};
    if (currencyCode) patch.currency_code = currencyCode;
    if (shopName) patch.shop_name = shopName;

    if (Object.keys(patch).length === 0) {
      return { ok: false, currencyCode, shopName };
    }

    const db = getServiceClient();
    const { error } = await db
      .from("shops")
      .update(patch)
      .eq("id", shopInternalId);

    if (error) {
      console.warn(
        "[persistShopCurrency] update failed",
        { shopInternalId, message: error.message },
      );
      return { ok: false, currencyCode, shopName };
    }

    return { ok: true, currencyCode, shopName };
  } catch (err) {
    console.warn(
      "[persistShopCurrency] fetch/update threw",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, currencyCode: null, shopName: null };
  }
}
