/**
 * Shop identity cross-check used by middleware. The `shopify_shop` cookie is
 * scoped to our host — not per-shop — so the same browser can carry a cookie
 * for store A while Shopify sends `?shop=B` for another Admin tab. Before
 * trusting the cookie, confirm it matches the shop Shopify is asserting.
 *
 * Returns true when the two values agree (case-insensitive) or when the caller
 * didn't pass a shop to compare. Returns false only when both are present and
 * disagree — the mismatch signal.
 */
export function shopIdentityMatches(
  cookieShop: string | undefined | null,
  urlShop: string | undefined | null
): boolean {
  if (!urlShop || !cookieShop) return true;
  return urlShop.toLowerCase() === cookieShop.toLowerCase();
}
