/**
 * Normalise Shopify's `Shop.primaryDomain.url` down to a bare host.
 *
 * Shopify returns a full URL (`https://meinmaison.com/`), but every consumer
 * — the admin Shops list, search, comparisons against `shops.shop_domain` —
 * wants a hostname. Normalising once, at the write, keeps the stored value
 * directly comparable to `shop_domain` (also a bare host) instead of leaving
 * each read site to strip the scheme its own way.
 *
 * Returns null for anything unparseable so a malformed value is simply not
 * written, leaving whatever good value the column already holds.
 */
export function toDomainHost(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;

  try {
    // Shopify always sends a scheme; tolerate a bare host anyway rather than
    // discarding an otherwise-usable value.
    const host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
    return host.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * The domain to SHOW for a shop: its real storefront domain when we have one,
 * falling back to the myshopify alias. Shops installed before the
 * `primary_domain` backfill, and any shop whose enrichment call failed, have
 * a null column — they must still render something.
 *
 * A leading `www.` is dropped for display. Shopify genuinely reports
 * `www.blume.com` as that shop's primary domain and the column stores it that
 * way — faithful to the source, and still correct if the value is ever used
 * for matching — but in a list meant for scanning, `blume.com` is how anyone
 * would refer to the merchant. Display-only: never write the stripped form
 * back to the column.
 */
export function displayShopDomain(shop: {
  primary_domain?: string | null;
  shop_domain: string;
}): string {
  const domain = shop.primary_domain?.trim() || shop.shop_domain;
  return domain.replace(/^www\./i, "");
}

/**
 * The host a Shopify APP PROXY is reachable on, or null.
 *
 * Distinct from `displayShopDomain` in two ways that matter, which is why it
 * is a separate function rather than a reuse:
 *
 *   1. `www.` is KEPT. This value is sent in a real request and used as the
 *      Origin/Referer; stripping a subdomain that actually serves the store
 *      would produce a 403 or a redirect.
 *   2. A shop still on its `*.myshopify.com` host returns **null**, not the
 *      myshopify domain. A proxy call there is refused, so the honest answer
 *      is "no storefront host", which disables tracking-app lookups cleanly
 *      rather than burning a request per shipment on a guaranteed failure.
 *
 * Never write the result back to `shops.primary_domain`.
 */
export function storefrontDomainOf(shop: {
  primary_domain?: string | null;
  shop_domain: string;
}): string | null {
  const domain = shop.primary_domain?.trim();
  if (!domain) return null;
  if (/\.myshopify\.com$/i.test(domain)) return null;
  return domain;
}
