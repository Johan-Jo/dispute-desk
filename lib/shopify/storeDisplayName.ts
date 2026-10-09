/**
 * The name to CALL a store in merchant-facing copy (emails): the merchant's
 * own store name — Shopify `Shop.name`, e.g. "Mein Maison" — never the
 * `*.myshopify.com` alias, which is an opaque handle (`whj8db-1q`) the
 * merchant does not recognise as their business.
 *
 * `shops.shop_name` is best-effort enrichment, so it can be null. The
 * fallback is the storefront's own custom domain when one is on record;
 * a myshopify host is never returned. Null means "nothing personal to show"
 * — the caller falls back to its own generic wording ("your store").
 *
 * The single path for this decision: every merchant email resolves its store
 * label here (pinned by `lib/email/__tests__/storeNameInvariant.test.ts`).
 */
export function storeDisplayName(
  shop:
    | { shop_name?: string | null; primary_domain?: string | null }
    | null
    | undefined,
): string | null {
  const name = shop?.shop_name?.trim();
  if (name) return name;

  const domain = shop?.primary_domain?.trim().replace(/^www\./i, "");
  if (domain && !/\.myshopify\.com$/i.test(domain)) return domain;

  return null;
}
