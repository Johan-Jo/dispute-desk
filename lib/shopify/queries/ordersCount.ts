/**
 * Shopify GraphQL `ordersCount` query — used by the daily metrics
 * snapshot job to populate `shop_daily_metrics.order_count`.
 *
 * Why ordersCount over a paginated `orders` connection:
 *   - One call per (shop, date) regardless of order volume.
 *   - No nested fields → minimal query cost (1 point).
 *   - For high-volume shops the connection approach would burn the
 *     1000-point bucket fast on backfill (90d × N shops).
 *
 * `ordersCount` is available since API version 2024-04. We're pinned at
 * 2026-01 (lib/shopify/client.ts), so it's safe.
 *
 * The query string syntax is Shopify's search DSL — `created_at:>=...`
 * uses ISO-8601. The precision field returns `EXACT` for shops under
 * the count limit (~10,000 in observed practice) and
 * `AT_LEAST_APPROXIMATE` once the shop crosses Shopify's exact-count
 * threshold. We persist whatever Shopify reports; merchants in that
 * size range have other risk signals more reliable than raw count.
 */

export const SHOP_ORDERS_COUNT_QUERY = /* GraphQL */ `
  query ShopOrdersCount($query: String!) {
    ordersCount(query: $query) {
      count
      precision
    }
  }
`;

export interface OrdersCountResult {
  count: number;
  precision: "EXACT" | "AT_LEAST_APPROXIMATE";
}

/** Compose a Shopify search query for orders created within a UTC day. */
export function ordersCountSearchQueryForDate(dateIso: string): string {
  // dateIso is a YYYY-MM-DD string (UTC). Shopify's search accepts
  // RFC3339 timestamps; we anchor to UTC midnight on both ends so the
  // boundary is unambiguous regardless of the merchant's shop timezone
  // — the metric is reported in UTC days.
  const start = `${dateIso}T00:00:00Z`;
  const next = nextUtcDateIso(dateIso);
  const end = `${next}T00:00:00Z`;
  return `created_at:>=${start} created_at:<${end}`;
}

function nextUtcDateIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
