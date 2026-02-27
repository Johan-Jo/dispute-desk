/**
 * Append `shop` and `host` query params from the current URL
 * to a target pathname. Used for Shopify embedded app navigation
 * to maintain iframe context.
 */
export function withShopParams(
  pathname: string,
  searchParams: URLSearchParams | Record<string, string>
): string {
  const sp =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams);

  const params = new URLSearchParams();
  const shop = sp.get("shop");
  const host = sp.get("host");
  if (shop) params.set("shop", shop);
  if (host) params.set("host", host);

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
