import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

/**
 * Public URL for primary CTAs ("get the app" / install flow).
 *
 * - Set **`NEXT_PUBLIC_SHOPIFY_APP_STORE_URL`** to the exact listing URL from
 *   Shopify Partners -> App -> Distribution (after the app is on the App Store).
 * - If unset, links to the marketing home page with the pricing anchor so visitors
 *   stay on-site instead of hitting a missing App Store listing or a portal sign-up form.
 */
export function getMarketingShopifyAppInstallUrl(): string {
  const listing = process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim();
  if (listing) return listing;
  const base = getPublicSiteBaseUrl();
  return `${base}/#pricing`;
}

/**
 * Client-safe install URL for use in client components.
 * Uses only NEXT_PUBLIC_* env vars (inlined at build time).
 * Falls back to /#pricing when no App Store listing is set.
 */
export const SHOPIFY_INSTALL_URL: string =
  process.env.NEXT_PUBLIC_SHOPIFY_APP_STORE_URL?.trim() || "/#pricing";
