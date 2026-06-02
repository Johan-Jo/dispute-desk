import { getPublicSiteBaseUrl } from "@/lib/email/publicSiteUrl";

/**
 * Public URL for primary install CTAs across the marketing site.
 *
 * We deliberately route ALL install buttons to the on-site pricing section
 * (`/#pricing`) rather than the Shopify App Store listing. The pricing section
 * opens a direct-install pop-up (merchant types their shop domain → OAuth),
 * which bypasses the App Store page and lets us carry the chosen plan through
 * install. `NEXT_PUBLIC_SHOPIFY_APP_STORE_URL` is intentionally NOT consulted
 * here — even if it is set, we keep the direct-install flow.
 */
export function getMarketingShopifyAppInstallUrl(): string {
  return `${getPublicSiteBaseUrl()}/#pricing`;
}

/**
 * Client-safe install URL for use in client components (relative, so it works
 * from any locale-prefixed marketing page). Always the on-site pricing anchor
 * — see {@link getMarketingShopifyAppInstallUrl} for why we don't link the
 * App Store listing.
 */
export const SHOPIFY_INSTALL_URL = "/#pricing";
