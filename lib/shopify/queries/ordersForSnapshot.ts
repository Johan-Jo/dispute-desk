/**
 * Orders LIST query for the chargeback-rate snapshot pipeline.
 *
 * Replaces the prior `ordersCount` field, which was confirmed to
 * return wrong counts for narrow `created_at:>=...Z created_at:<...Z`
 * compound range filters in API version 2026-01 — the second range
 * clause was effectively double-counting orders straddling day
 * boundaries (verified against surasvenne: window=7 orders, but
 * per-day-summed=14). The orders connection's `created_at:` filter
 * works correctly, so we paginate the connection and group by UTC
 * date in code.
 *
 * Fields:
 *   - `id` — order GID, used to cross-reference disputes' `order_gid`.
 *   - `createdAt` — RFC3339 UTC timestamp; we slice the date portion
 *     to bucket per UTC day.
 *   - `test` — true when the order is a Bogus Gateway / test order.
 *     Per the chargeback-rate fix, test orders are excluded from
 *     both the numerator (their disputes) and the denominator.
 *
 * Cost: ~3 query points per page of 250 orders. A 90-day backfill
 * for a typical shop fits in one page; high-volume merchants
 * paginate. The wrapper's pagination respects throttle headroom.
 */

import { requestShopifyGraphQL } from "@/lib/shopify/graphql";
import {
  assertNotAuthInvalid,
  assertShopAvailable,
} from "@/lib/shopify/sessions/getShopBackgroundSession";

export const ORDERS_FOR_SNAPSHOT_QUERY = /* GraphQL */ `
  query ShopOrdersForSnapshot($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      edges {
        cursor
        node {
          id
          createdAt
          test
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PAGE_SIZE = 250;

export interface OrderForSnapshot {
  /** Shopify order GID — `gid://shopify/Order/123…`. */
  gid: string;
  /** UTC ISO timestamp (RFC3339). */
  createdAt: string;
  /** True for Bogus-Gateway / test orders. */
  isTest: boolean;
}

interface ShopifySession {
  shopDomain: string;
  accessToken: string;
}

/**
 * Fetch all orders in a UTC window via the Shopify orders connection,
 * paginating until done. Returns the raw order list — callers group
 * by UTC date and apply test-order filtering as needed.
 *
 * Window semantics:
 *   - `fromDateIso` inclusive lower bound (UTC midnight)
 *   - `toExclusiveDateIso` exclusive upper bound (UTC midnight)
 *
 * E.g. a "trailing 90 days ending yesterday" window from `2026-02-01`
 * to `2026-05-01` (exclusive) covers exactly 90 UTC days.
 */
export async function fetchOrdersInWindow(
  session: ShopifySession,
  fromDateIso: string,
  toExclusiveDateIso: string,
  opts: { correlationId?: string; maxPages?: number } = {},
): Promise<OrderForSnapshot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDateIso)) {
    throw new Error(`fetchOrdersInWindow: invalid fromDateIso "${fromDateIso}"`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toExclusiveDateIso)) {
    throw new Error(`fetchOrdersInWindow: invalid toExclusiveDateIso "${toExclusiveDateIso}"`);
  }

  const queryString = `created_at:>=${fromDateIso}T00:00:00Z created_at:<${toExclusiveDateIso}T00:00:00Z`;
  // Hard cap to prevent runaway loops. 200 pages × 250 = 50k orders
  // covered, more than enough for a 90-day window even on busy shops.
  const maxPages = opts.maxPages ?? 200;

  type OrdersPage = {
    orders: {
      edges: Array<{
        cursor: string;
        node: { id: string; createdAt: string; test: boolean };
      }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  type OrdersGqlResponse = {
    data?: OrdersPage;
    errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  };

  const all: OrderForSnapshot[] = [];
  let after: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const resp: OrdersGqlResponse = await requestShopifyGraphQL<OrdersPage>({
      session,
      query: ORDERS_FOR_SNAPSHOT_QUERY,
      variables: { first: PAGE_SIZE, after, query: queryString },
      correlationId: opts.correlationId
        ? `${opts.correlationId}-p${page}`
        : `orders-snapshot-p${page}`,
    });

    assertNotAuthInvalid(session.shopDomain, "offline", { errors: resp.errors ?? null });
    /* A DELETED STORE IS NOT A TRANSIENT ERROR.
     *
     * `Unavailable Shop` fell through to the generic throw below and was
     * re-queued daily. Two dev stores had 34 failed jobs each by 2026-08-13 —
     * one per day since they vanished — and the noise is what hid the
     * possibility of a REAL unavailable shop among them. Typed here so the
     * dispatcher can refuse to retry. */
    assertShopAvailable(session.shopDomain, { errors: resp.errors ?? null });
    if (resp.errors && resp.errors.length > 0) {
      throw new Error(
        `Shopify orders list failed: ${resp.errors.map((e) => e.message).join("; ")}`,
      );
    }
    const data: OrdersPage["orders"] | undefined = resp.data?.orders;
    if (!data) {
      throw new Error("Shopify orders list returned no data");
    }

    for (const edge of data.edges) {
      all.push({
        gid: edge.node.id,
        createdAt: edge.node.createdAt,
        isTest: edge.node.test === true,
      });
    }

    if (!data.pageInfo.hasNextPage) return all;
    after = data.pageInfo.endCursor;
    if (!after) return all;
  }

  throw new Error(
    `fetchOrdersInWindow: hit maxPages=${maxPages} for ${session.shopDomain} window ${fromDateIso}..${toExclusiveDateIso}; ` +
      `${all.length} orders fetched. Increase maxPages or narrow the window.`,
  );
}

/** Pure helper: bucket orders into UTC-day order counts. Returns a
 *  Map<dateIso → count>.
 *
 *  Test-order exclusion (the `if (o.isTest) continue` rule) was
 *  removed 2026-05-01 at the user's request so dev shops with
 *  Bogus-Gateway test orders read realistic numbers during local
 *  testing. The `testOrderGidSet` helper below is kept for the
 *  eventual re-enable when promoting from dev → prod. */
export function bucketOrdersByUtcDay(orders: OrderForSnapshot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of orders) {
    const dateIso = o.createdAt.slice(0, 10);
    counts.set(dateIso, (counts.get(dateIso) ?? 0) + 1);
  }
  return counts;
}

/** Pure helper: build a Set of test-order GIDs. **Currently unused**
 *  — the test-order filter was reverted 2026-05-01 to let dev shops
 *  surface realistic numbers. Kept exported so the eventual prod
 *  re-enable doesn't have to re-implement it. */
export function testOrderGidSet(orders: OrderForSnapshot[]): Set<string> {
  const set = new Set<string>();
  for (const o of orders) {
    if (o.isTest) set.add(o.gid);
  }
  return set;
}
