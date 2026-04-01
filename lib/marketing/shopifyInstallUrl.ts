/**
 * Public URL for "download / get the app" CTAs: Shopify App Store (install → OAuth → Admin → embedded).
 *
 * Set `NEXT_PUBLIC_SHOPIFY_APP_STORE_URL` to override (e.g. staging listing).
 * Default is the canonical App Store path — search URLs break for some locales (e.g. pt-BR empty results).
 */
const DEFAULT_APP_STORE_LISTING = "https://apps.shopify.com/disputedesk";

export function getMarketingShopifyAppInstallUrl(): string {
  const listing = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim();
  if (listing) return listing;
  return DEFAULT_APP_STORE_LISTING;
}
