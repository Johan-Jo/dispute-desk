import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

const FALLBACK_UTM =
  "utm_source=marketing&utm_medium=install_cta&utm_campaign=app_store_fallback";

/**
 * Public URL for primary article CTAs (“get the app” / install flow).
 *
 * - Set **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`** to the exact listing URL from
 *   Shopify Partners → App → Distribution (after the app is on the App Store).
 * - If unset, merchants are sent to **portal sign-up** on this site so the link
 *   never points at a missing `apps.shopify.com/...` page (common before listing).
 */
export function getMarketingShopifyAppInstallUrl(): string {
  const listing = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim();
  if (listing) return listing;
  const base = getPublicSiteBaseUrl();
  return `${base}/auth/sign-up?${FALLBACK_UTM}`;
}
