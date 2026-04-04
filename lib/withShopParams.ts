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
  const locale = sp.get("locale");
  const ddDebug = sp.get("dd_debug");
  if (shop) params.set("shop", shop);
  if (host) params.set("host", host);
  if (locale) params.set("locale", locale);
  if (ddDebug) params.set("dd_debug", ddDebug);

  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
