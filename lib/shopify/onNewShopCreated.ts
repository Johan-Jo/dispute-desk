/**
 * The side effects that must fire exactly once, when a `shops` row is first
 * created for a merchant — regardless of WHICH install path created it.
 *
 * ## Why this module exists
 *
 * The admin "new merchant installed" alert has now been lost three separate
 * times, each time because a new install path was added without the side
 * effects that the older path carried:
 *
 *   - 2026-05-31 (`6mjjvm-tc`): the only alert was `sendAdminSignupNotification`,
 *     gated on `source === "portal"`. Embedded App Store installs skipped it.
 *     Fixed by `sendAdminInstallNotification` (1549d007).
 *   - 2026-07 (`daniel-store` / `blume-box` / `cay-collective`): the alert fired
 *     but was un-awaited, and Vercel froze the instance on redirect before the
 *     Shopify round-trip finished (001acb49, 7a1fa1c7).
 *   - 2026-08-29 (`6a8848-dd`, and `isj-153` on 08-26): Session Token Exchange
 *     (`/api/auth/shopify/token-exchange`) became a second shop-creating path
 *     and inserted `shops` rows silently — no alert, and no Free-tier pack
 *     grant either. All three earlier fixes lived in the OAuth callback, so
 *     none of them applied.
 *
 * The first two fixes patched the instance. This module closes the class: both
 * insert sites call `onNewShopCreated`, and `newShopSideEffects.test.ts`
 * enumerates every `.insert(...)` into `shops` in the repo and fails the build
 * if one doesn't route through here. A fourth install path cannot silently
 * repeat the bug.
 *
 * ## Ordering contract
 *
 * The admin notification is AWAITED by design and everything else is
 * fire-and-forget. Both install paths end in an immediate redirect, and Vercel
 * kills the serverless instance the moment the response returns — an
 * un-awaited `fetchShopDetails` → `send` chain (a Shopify GraphQL round-trip)
 * loses that race and the email never sends. That was the 2026-07 regression;
 * do not make this fire-and-forget again.
 *
 * Nothing here throws: every step is independently caught so a failing side
 * effect can never break an otherwise-working install.
 */

import type { Locale } from "@/lib/i18n/locales";
import { fetchShopDetails } from "@/lib/shopify/shopDetails";
import { grantFreeLifetimeCredits } from "@/lib/billing/grantFreeLifetime";
import { sendAdminInstallNotification } from "@/lib/email/sendAdminNotification";
import { sendInstallWelcomeEmail } from "@/lib/email/sendInstallWelcome";

export interface OnNewShopCreatedOptions {
  /** Internal `shops.id` of the just-inserted row. */
  shopInternalId: string;
  /** The merchant's myshopify domain — always known at install time. */
  shopDomain: string;
  /**
   * Which entry point created the shop. Rendered verbatim in the admin alert
   * so a missed install can be traced back to its path.
   */
  source: string;
  /** Merchant locale, for the welcome email. Defaults to English. */
  locale?: Locale;
}

/**
 * Run the once-per-new-merchant side effects. Awaits the admin notification
 * (see the ordering contract above); never throws.
 */
export async function onNewShopCreated(
  options: OnNewShopCreatedOptions,
): Promise<void> {
  const { shopInternalId, shopDomain, source } = options;

  // Free-tier lifetime pack floor — grant N usable packs once per new shop so
  // the Free plan isn't blocked at its first pack build. Idempotent (guards on
  // an existing free_lifetime ledger row), so a re-install can't double-grant.
  // Fire-and-forget: never blocks the install redirect.
  grantFreeLifetimeCredits(shopInternalId).catch((err) => {
    console.warn(
      "[billing] free_lifetime grant failed:",
      err instanceof Error ? err.message : err,
    );
  });

  // Enrichment (store name / owner email) is best-effort: on a fresh install
  // this is the FIRST authed call after the token was stored milliseconds ago,
  // and Shopify commonly 401s that first request before the token propagates —
  // fetchShopDetails then THROWS. That throw must NOT suppress the
  // notification: shopDomain alone is always known and the enriched fields
  // render as "—" when absent. So swallow the fetch failure to null and
  // always send.
  const details = await fetchShopDetails(shopInternalId).catch((err) => {
    console.warn(
      "[email:admin-install] shop-details enrichment failed; sending without it:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });

  await sendAdminInstallNotification({
    shopDomain,
    email: details?.email,
    shopName: details?.name,
    source,
  }).catch((err) => {
    console.warn(
      "[email:admin-install] notification failed:",
      err instanceof Error ? err.message : err,
    );
  });

  // Merchant-facing welcome. Awaited for the same reason as the admin alert:
  // both install paths end in an immediate redirect and Vercel kills the
  // instance on return, so a fire-and-forget send would lose the race.
  //
  // Recipient is the Shopify shop-owner address from the same `details` fetch
  // above — the merchant-configured alert address (Settings → team email) does
  // not exist yet at install time. When enrichment failed, `to` is undefined
  // and the sender skips rather than guessing an address.
  await sendInstallWelcomeEmail({
    shopInternalId,
    shopDomain,
    to: details?.email,
    shopName: details?.name,
    locale: options.locale,
  }).catch((err) => {
    console.warn(
      "[email:install-welcome] send threw:",
      err instanceof Error ? err.message : err,
    );
  });
}
