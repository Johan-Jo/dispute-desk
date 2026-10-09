/**
 * Builds the redirect to /api/auth/shopify/token-exchange for an embedded
 * load that carries a Shopify `id_token`. Edge-safe (no crypto).
 *
 * `locale` — the language the merchant selected in Shopify Admin — must be
 * forwarded as its own parameter. It used to survive only inside `return_to`,
 * where the exchange route never read it, so every shop installed through
 * this path was stored with the column default (`en-US`) and got its
 * welcome + billing emails in English: Mein Maison (German, 2026-08-29) and
 * Hem & Trend (Swedish, 2026-10-09).
 */
export function buildTokenExchangeUrl(
  reqUrl: string,
  params: {
    idToken: string;
    shop: string;
    host: string;
    locale: string;
    returnTo: string;
  },
): URL {
  const url = new URL("/api/auth/shopify/token-exchange", reqUrl);
  url.searchParams.set("id_token", params.idToken);
  url.searchParams.set("shop", params.shop);
  if (params.host) url.searchParams.set("host", params.host);
  if (params.locale) url.searchParams.set("locale", params.locale);
  url.searchParams.set("return_to", params.returnTo);
  return url;
}
