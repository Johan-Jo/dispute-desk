/**
 * Single source of truth for whether Shopify billing charges are
 * created as TEST charges.
 *
 * Test mode is on when ANY of:
 *  - `SHOPIFY_BILLING_TEST === "true"` (explicit override — must NEVER
 *    be set on prod; see the 2026-07-22 prod incident where it lingered
 *    for 109 days and every charge was a test charge),
 *  - `APP_ENV === "development"` (the validated dev/prod identity from
 *    lib/env/build-identity.ts — the dev Vercel project always sets it,
 *    and development stores can only accept test charges, so real
 *    charges on dev fail with "Top-up didn't go through"),
 *  - `NODE_ENV !== "production"` (local dev servers).
 *
 * Used by every charge-creating route (subscribe, top-up) so the flag
 * logic cannot drift between them.
 */
export function isBillingTestMode(): boolean {
  return (
    process.env.SHOPIFY_BILLING_TEST === "true" ||
    process.env.APP_ENV === "development" ||
    process.env.NODE_ENV !== "production"
  );
}
