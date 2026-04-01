/**
 * Public URL for "download / get the app" CTAs: Shopify App Store (install → OAuth → Admin → embedded).
 *
 * Set `NEXT_PUBLIC_SHOPIFY_APP_STORE_URL` to your listing, e.g. `https://apps.shopify.com/your-handle`.
 * If unset, uses App Store search so the secondary CTA stays distinct from "Try for free" (web connect).
 */
export function getMarketingShopifyAppInstallUrl(): string {
  const listing = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim();
  if (listing) return listing;
  return "https://apps.shopify.com/search?q=DisputeDesk";
}
