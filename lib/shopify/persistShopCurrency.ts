/**
 * Fetch the Shopify shop's profile and persist the durable bits —
 * primary/presentment currency to `shops.currency_code`, the
 * merchant-facing store name to `shops.shop_name`, and the storefront's
 * real domain to `shops.primary_domain`. Used by:
 *
 *   - OAuth callback (offline phase) — populates currency on first install
 *   - Token-exchange (embedded re-auth) — populates currency if missing
 *   - shop/update webhook — refreshes currency if the merchant changed it
 *
 * `shop_name` and `primary_domain` matter because `shops.shop_domain` is only
 * the myshopify alias — `6a8848-dd.myshopify.com` for a store actually called
 * "Mein Maison" that customers reach at `meinmaison.com`. Without persisting
 * them, merchant-facing copy (the install welcome email) and ops surfaces (the
 * admin Shops list) have nothing but the opaque alias, and recovering the real
 * values later needs a live Admin call with an offline token that may since
 * have expired or been revoked. The shop/update webhook call site means a
 * rename or a domain change propagates on its own.
 *
 * Idempotent and safe to fire-and-forget. Failures are logged and
 * swallowed — a missing `currency_code` falls back to the legacy
 * most-frequent-dispute-currency heuristic in
 * `lib/disputes/metrics.ts`, and a missing `shop_name` / `primary_domain`
 * degrades the greeting or falls back to the myshopify alias rather than
 * blocking anything, so failure here is graceful degradation, not a
 * broken install.
 *
 * The Shop query needs an offline session, so this helper MUST be
 * called AFTER `storeSession`.
 */

import { getServiceClient } from "@/lib/supabase/server";
import { fetchShopDetails } from "./shopDetails";
import { toDomainHost } from "./domainHost";

export async function persistShopCurrency(
  shopInternalId: string,
): Promise<{
  ok: boolean;
  currencyCode: string | null;
  shopName: string | null;
  primaryDomain: string | null;
}> {
  try {
    const details = await fetchShopDetails(shopInternalId);
    if (!details) {
      return { ok: false, currencyCode: null, shopName: null, primaryDomain: null };
    }

    const currencyCode = details.currencyCode ?? null;
    const shopName = details.name?.trim() || null;
    const primaryDomain = toDomainHost(details.primaryDomain);

    // Write only what Shopify actually returned, so a partial response can
    // never blank a column that already holds a good value.
    const patch: {
      currency_code?: string;
      shop_name?: string;
      primary_domain?: string;
    } = {};
    if (currencyCode) patch.currency_code = currencyCode;
    if (shopName) patch.shop_name = shopName;
    if (primaryDomain) patch.primary_domain = primaryDomain;

    if (Object.keys(patch).length === 0) {
      return { ok: false, currencyCode, shopName, primaryDomain };
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
      return { ok: false, currencyCode, shopName, primaryDomain };
    }

    return { ok: true, currencyCode, shopName, primaryDomain };
  } catch (err) {
    console.warn(
      "[persistShopCurrency] fetch/update threw",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, currencyCode: null, shopName: null, primaryDomain: null };
  }
}
