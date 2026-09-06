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
 */
export function displayShopDomain(shop: {
  primary_domain?: string | null;
  shop_domain: string;
}): string {
  return shop.primary_domain?.trim() || shop.shop_domain;
}
