/**
 * Append `shop` and `host` query params from the current URL
 * to a target pathname. Used for Shopify embedded app navigation
 * to maintain iframe context.
 *
 * The pathname may already contain its own query string (e.g.
 * `/app/rules?family=fraud`); in that case the shop params are
 * merged into the existing query string rather than naively
 * appended with a second `?`.
 */
export function withShopParams(
  pathname: string,
  searchParams: URLSearchParams | Record<string, string>
): string {
  const sp =
    searchParams instanceof URLSearchParams
      ? searchParams
      : new URLSearchParams(searchParams);

  const [basePath, existingQs] = pathname.split("?", 2);
  const params = new URLSearchParams(existingQs ?? "");

  const shop = sp.get("shop");
  const host = sp.get("host");
  const locale = sp.get("locale");
  const ddDebug = sp.get("dd_debug");
  if (shop) params.set("shop", shop);
  if (host) params.set("host", host);
  if (locale) params.set("locale", locale);
  if (ddDebug) params.set("dd_debug", ddDebug);

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
