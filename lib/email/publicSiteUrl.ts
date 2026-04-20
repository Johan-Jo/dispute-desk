/**
 * Base URL for customer-facing links in transactional emails.
 *
 * Do not fall back to `VERCEL_URL`: on preview deployments it is a branch-specific
 * hostname, so links in emails would point at the wrong deployment.
 *
 * Matches `app/robots.ts` / `app/sitemap.ts`: prefer `NEXT_PUBLIC_APP_URL`, else
 * the public marketing origin.
 */
export function getPublicSiteBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL ?? process.env.PUBLIC_CANONICAL_URL;
  if (raw?.trim()) {
    return raw.trim().replace(/\/$/, "");
  }
  return "https://disputedesk.app";
}

/**
 * Build a Shopify Admin deep link that opens the embedded app.
 *
 * Historical note: we used to deep-link directly into the sub-path
 * (`/apps/disputedesk-1/disputes/{id}`), but Shopify Admin's iframe launcher
 * did not reliably attach `host` + `shop` on cold loads from email — the app
 * layout's host-recovery script couldn't run because middleware redirected to
 * `/app/session-required` first and the iframe rendered "refused to connect."
 *
 * Fix: link to the app root only (`/apps/disputedesk-1`) and pass the intended
 * sub-path in `?ddredirect=`. Admin launches the app at its configured
 * application_url with valid `host`/`shop` params; the embedded root page
 * reads `ddredirect` after App Bridge initializes and navigates client-side.
 *
 * Falls back to the public site URL when shopDomain is not available.
 */
export function getEmbeddedAppUrl(
  shopDomain: string | null,
  path: string,
): string {
  const normalizedPath = `/${path.replace(/^\//, "")}`;
  if (shopDomain) {
    const handle = shopDomain.replace(/\.myshopify\.com$/, "");
    const encoded = encodeURIComponent(normalizedPath);
    return `https://admin.shopify.com/store/${handle}/apps/disputedesk-1?ddredirect=${encoded}`;
  }
  return `${getPublicSiteBaseUrl()}/app${normalizedPath}`;
}
